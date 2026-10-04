import asyncio
import contextlib
from collections.abc import AsyncIterator

import structlog
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from travelmind.agent import service as agent_service
from travelmind.agent.router import agent_router
from travelmind.agent.service import stuck_runs_loop as stuck_agent_runs_loop
from travelmind.agent.tools.external import warn_about_feed_settings
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
from travelmind.identity.sessioncache import listen_for_evictions
from travelmind.jobs import close_job_queue
from travelmind.metrics import MetricsMiddleware, metrics_router
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

STUCK_RUNS_INTERVAL_SECONDS = 60  # as the worker's cron


async def close_model_clients() -> None:
    """Close the Gemini SDK clients, if anything in this process opened one."""
    from travelmind.agent import gemini

    try:
        await gemini.close_clients()
    except Exception as exc:
        structlog.get_logger().warning("model_clients_close_failed", error_type=type(exc).__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the demo cleanup at startup and then every interval, and the stuck agent run sweep
    every minute (not under tests, and not where a worker owns the schedules), listen for
    session evictions, and close the process-wide clients on shutdown."""
    settings = get_settings()
    warn_about_feed_settings(settings)
    cleanup: asyncio.Task[None] | None = None
    sweep: asyncio.Task[None] | None = None
    if settings.environment != "test" and settings.run_scheduler:
        cleanup = asyncio.create_task(demo_cleanup_loop(settings.demo_cleanup_interval_seconds))
        sweep = asyncio.create_task(stuck_agent_runs_loop(STUCK_RUNS_INTERVAL_SECONDS))
    # Other processes' logouts reach this process's session cache through Redis.
    evictions = asyncio.create_task(listen_for_evictions())
    try:
        yield
    finally:
        for task in (cleanup, sweep, evictions):
            if task is not None:
                task.cancel()
                # A task that failed must not stop the clients below from closing.
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        # Inline agent runs (development) stop and are marked interrupted.
        with contextlib.suppress(Exception):
            await agent_service.drain_inline_runs(cancel=True)
        # Each close runs even if an earlier one fails.
        try:
            await close_model_clients()
            await close_http_clients()
        finally:
            try:
                await close_job_queue()
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
    # Metrics → RequestId → CORS → OriginCheck → UnhandledError → app.
    # Metrics is outermost so its timing covers the whole stack and it sees the final status.
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
    app.add_middleware(MetricsMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(health_router)
    app.include_router(metrics_router)
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
    app.include_router(agent_router)
    return app
