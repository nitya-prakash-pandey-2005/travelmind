from functools import lru_cache
from typing import Annotated, Literal

from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TM_", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://travelmind_app:app_dev_pw@localhost:5433/travelmind"
    migration_database_url: str = (
        "postgresql+asyncpg://travelmind_owner:owner_dev_pw@localhost:5433/travelmind"
    )
    redis_url: str = "redis://localhost:6380/0"
    allowed_origins: list[str] = ["http://localhost:5173"]
    session_cookie_name: str = "tm_session"
    session_ttl_hours: int = 24 * 14
    invitation_ttl_hours: int = 24 * 7
    cookie_secure: bool = False
    login_max_attempts: int = 10
    login_window_seconds: int = 15 * 60
    login_ip_max_attempts: int = 50
    signup_max_per_ip: int = 10
    signup_window_seconds: int = 3600
    # Suppliers & market data — an empty value means "not connected".
    duffel_token: str = ""
    duffel_supplier_timeout_ms: int = 12000
    liteapi_key: str = ""
    google_tim_api_key: str = ""
    travelpayouts_token: str = ""
    # None (or an empty TM_SANDBOX_SUPPLIER=) → on everywhere except production
    sandbox_supplier: Annotated[bool | None, BeforeValidator(_blank_to_none)] = None
    fx_enabled: bool = True
    search_timeout_seconds: float = 25.0
    search_max_per_minute: int = 30
    reprice_max_per_minute: int = 60  # price checks call the supplier too; a separate budget
    log_level: str = "INFO"

    @property
    def sandbox_supplier_enabled(self) -> bool:
        if self.sandbox_supplier is not None:
            return self.sandbox_supplier
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
