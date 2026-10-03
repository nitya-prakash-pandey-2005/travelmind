import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from travelmind.cache import close_redis
from travelmind.config import get_settings
from travelmind.dashboard.router import (
    dashboard_router,
    notifications_router,
    onboarding_router,
    search_router,
)
from travelmind.db import get_engine
from travelmind.demo.cleanup import demo_cleanup_loop
from travelmind.demo.router import demo_router
from travelmind.fareintel.routes import routes_router
from travelmind.health import router as health_router
from travelmind.hotels.router import hotels_router
from travelmind.http import close_http_clients
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
from travelmind.offers.router import flights_router, suppliers_router
from travelmind.platform import platform_router
from travelmind.reference.router import reference_router
from travelmind.workspace.agency import agency_router
from travelmind.workspace.clients import clients_router
from travelmind.workspace.enquiries import enquiries_router
from travelmind.workspace.public_quotes import public_quotes_router
from travelmind.workspace.quotes import quotes_router
from travelmind.workspace.timelines import timelines_router


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the demo cleanup at startup and then every interval (not under tests, and not where a
    worker owns the schedules), and close the process-wide clients on shutdown."""
    settings = get_settings()
    cleanup: asyncio.Task[None] | None = None
    if settings.environment != "test" and settings.run_scheduler:
        cleanup = asyncio.create_task(demo_cleanup_loop(settings.demo_cleanup_interval_seconds))
    try:
        yield
    finally:
        if cleanup is not None:
            cleanup.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await cleanup
        # Each close runs even if an earlier one fails.
        try:
            await close_http_clients()
        finally:
            try:
                await close_redis()
            finally:
                await get_engine().dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="TravelMind API", version="0.1.0", lifespan=lifespan)
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
    app.include_router(flights_router)
    app.include_router(suppliers_router)
    app.include_router(hotels_router)
    app.include_router(agency_router)
    app.include_router(clients_router)
    app.include_router(enquiries_router)
    app.include_router(quotes_router)
    app.include_router(public_quotes_router)
    app.include_router(timelines_router)
    app.include_router(routes_router)
    app.include_router(dashboard_router)
    app.include_router(notifications_router)
    app.include_router(onboarding_router)
    app.include_router(search_router)
    app.include_router(demo_router)
    app.include_router(platform_router)
    return app
