from fastapi import FastAPI

from travelmind.config import get_settings
from travelmind.health import router as health_router
from travelmind.middleware import RequestIdMiddleware, unhandled_exception_handler
from travelmind.observability import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="TravelMind API", version="0.1.0")
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.include_router(health_router)
    return app
