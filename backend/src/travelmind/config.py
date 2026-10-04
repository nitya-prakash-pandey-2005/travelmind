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
    # Per-process pools. Size them so (API workers x (pool + overflow)) fits PgBouncer's limits.
    # Without PgBouncer, several workers need smaller pools: workers x (pool + overflow) must stay
    # within Postgres max_connections minus headroom (migrations, admin, the worker process).
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_timeout_s: float = 5.0
    db_statement_timeout_ms: int = 5000
    db_pgbouncer: bool = False  # transaction pooling: no prepared statements held across them
    redis_max_connections: int = 100
    redis_pool_timeout_s: float = 1.0  # how long a command waits for a free pooled connection
    # Connect and command deadline: an unreachable Redis fails fast (callers fall through) and
    # never hangs a request.
    redis_socket_timeout_s: float = 2.0
    # The read cache (readcache) is an optimisation, so it gives up much sooner than that: each
    # of its commands has this deadline, and after `failures` consecutive errors or timeouts it
    # skips Redis for `cooldown_s`, then lets one trial call through.
    read_cache_timeout_ms: int = 150
    read_cache_breaker_failures: int = 3
    read_cache_breaker_cooldown_s: float = 10.0
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
    # One-click demo workspaces: per-IP limit, lifetime and how often expired ones are removed.
    demo_max_per_ip: int = 5
    demo_window_seconds: int = 3600
    demo_ttl_days: int = 7
    demo_cleanup_interval_seconds: int = 3600
    # Periodic jobs in the API process. Off where a worker owns the schedules (production).
    run_scheduler: bool = True
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
    public_quote_max_per_minute: int = 60  # client quote page: per network and per link
    log_level: str = "INFO"
    # Bearer token for GET /metrics. Empty: /metrics is served only outside production.
    metrics_token: str = ""

    @property
    def sandbox_supplier_enabled(self) -> bool:
        if self.sandbox_supplier is not None:
            return self.sandbox_supplier
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
