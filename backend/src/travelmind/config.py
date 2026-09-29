from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
