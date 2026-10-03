import re
import uuid

import structlog
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
log = structlog.get_logger()


def _request_id_from(headers: Headers) -> str:
    supplied = headers.get(REQUEST_ID_HEADER, "")
    return supplied if _VALID_REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex


class RequestIdMiddleware:
    """Tags each request with an id: `request.state.request_id`, the structlog context and the
    `X-Request-ID` response header. A supplied id is kept when it is safe to echo.

    Pure ASGI: `BaseHTTPMiddleware` would add a task and a body-stream copy to every request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id_from(Headers(scope=scope))
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            structlog.contextvars.clear_contextvars()


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or uuid.uuid4().hex
    log.error("unhandled_error", request_id=request_id, exc_info=exc)
    return JSONResponse(
        {
            "detail": "Something went wrong on our side. Please try again.",
            "trace_id": request_id,
        },
        status_code=500,
        headers={REQUEST_ID_HEADER: request_id},
    )


class UnhandledErrorMiddleware:
    """Turns unhandled errors into the plain JSON 500 *inside* the CORS layer.

    Starlette's `Exception` handler runs in ServerErrorMiddleware, outside every user
    middleware, so its 500s carry no CORS headers and a browser SPA can't read the
    message or trace_id. Register this before CORSMiddleware (last-added = outermost)
    so CORS and the request-id header wrap its response. The app-level `Exception`
    handler stays as a backstop for errors raised outside this middleware.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_tracking_start(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking_start)
        except Exception as exc:
            if response_started:
                raise
            response = await unhandled_exception_handler(Request(scope), exc)
            await response(scope, receive, send)


VALIDATION_ERROR_MESSAGE = "Some of the information you entered isn't valid."
_REQUEST_PARTS = frozenset({"body", "query", "path", "header", "cookie"})


def _field_name(loc: tuple[int | str, ...]) -> str:
    parts = loc[1:] if len(loc) > 1 and loc[0] in _REQUEST_PARTS else loc
    return ".".join(str(part) for part in parts)


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Plain-language 422 that names the bad fields but never echoes what was submitted.

    Registered for RequestValidationError only; typed `Exception` to match Starlette's
    handler signature.
    """
    raw = exc.errors() if isinstance(exc, RequestValidationError) else []
    errors = [{"field": _field_name(tuple(e["loc"])), "message": e["msg"]} for e in raw]
    return JSONResponse({"detail": VALIDATION_ERROR_MESSAGE, "errors": errors}, status_code=422)


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Blocks state-changing browser requests from origins we don't serve (CSRF defence)."""

    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        super().__init__(app)
        self._allowed = frozenset(allowed_origins)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS and origin is not None and origin not in self._allowed:
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
        return await call_next(request)
