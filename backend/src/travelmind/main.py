from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from travelmind.config import get_settings
from travelmind.health import router as health_router
from travelmind.identity.router import auth_router, invitations_router, team_router
from travelmind.middleware import (
    REQUEST_ID_HEADER,
    OriginCheckMiddleware,
    RequestIdMiddleware,
    UnhandledErrorMiddleware,
    unhandled_exception_handler,
    validation_exception_handler,
)
from travelmind.observability import configure_logging
from travelmind.reference.router import reference_router


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="TravelMind API", version="0.1.0")
    # Starlette runs the last-added middleware first:
    # RequestId → CORS → OriginCheck → UnhandledError → app.
    # UnhandledError must sit inside CORS so 500s still carry CORS headers.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(OriginCheckMiddleware, allowed_origins=settings.allowed_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(invitations_router)
    app.include_router(team_router)
    app.include_router(reference_router)
    return app
