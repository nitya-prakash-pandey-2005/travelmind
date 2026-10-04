from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import BeforeValidator, Field, SecretStr, model_validator
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
    # Enqueueing a job or reading its status gives up after this (TimeoutError).
    job_queue_timeout_s: float = 2.0
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
    # Per-supplier guards (travelmind.resilience), per process: at most this many calls in flight
    # to one supplier (waiting up to `acquire_timeout_s` for a slot), and a breaker that skips
    # the supplier for `reset_s` after `threshold` consecutive failures.
    supplier_max_concurrent: int = 20
    supplier_acquire_timeout_s: float = 2.0
    supplier_breaker_threshold: int = 5
    supplier_breaker_reset_s: float = 30.0
    search_max_per_minute: int = 30
    # Offers kept per agency for price checks and quote versions (offers.cache); past it, the
    # soonest to expire go first.
    offer_store_max_per_agency: int = 2000
    reprice_max_per_minute: int = 60  # price checks call the supplier too; a separate budget
    public_quote_max_per_minute: int = 60  # client quote page: per network and per link
    # Agent engine (travelmind.agent). "auto": Gemini when a key is set, else the rule-based demo
    # planner; production never falls back to the demo planner (the agent is unavailable).
    agent_provider: Literal["gemini", "fake", "auto"] = "auto"
    agent_model: str = "gemini-2.5-flash"  # the one place the model id is set
    # Only from the environment (or .env): TM_GOOGLE_API_KEY, else (unset or blank) GOOGLE_API_KEY.
    # A SecretStr, so reprs, dumps and logs of the settings show it masked.
    google_api_key: Annotated[SecretStr | None, BeforeValidator(_blank_to_none)] = None
    # GOOGLE_API_KEY, read only to fill google_api_key (see _google_api_key_fallback).
    google_api_key_fallback: Annotated[SecretStr | None, BeforeValidator(_blank_to_none)] = Field(
        default=None, validation_alias="GOOGLE_API_KEY", exclude=True, repr=False
    )
    agent_max_steps: int = 12
    agent_step_timeout_s: float = 20.0
    agent_run_timeout_s: float = 120.0
    agent_run_token_cap: int = 60_000
    agent_monthly_token_budget: int = 2_000_000
    agent_max_concurrent_runs_per_agency: int = 3
    # How long a run slot is held at most, counted from when it is taken (at run creation), so it
    # covers the queue wait and the run itself (agent_run_timeout_s); a crashed holder's slot
    # lapses after this. See travelmind.agent.budget for what Task 3 must decide around it.
    agent_run_slot_ttl_s: float = 300.0
    # Places and weather for the agent's tools (travelmind.agent.tools). Contact for the
    # User-Agent sent to OpenStreetMap services (Nominatim, Overpass), whose usage policies ask
    # for an identifiable client: a URL or email of whoever runs this deployment. Empty sends
    # the product name only.
    osm_contact: str = ""
    # The public instances by default. Their policies (max 1 request/s for Nominatim, about
    # 10,000 requests a day for Overpass, no heavy or backend use) suit development and light
    # use; a busy production deployment should point these at its own or a paid instance.
    osm_nominatim_url: str = "https://nominatim.openstreetmap.org"
    osm_overpass_url: str = "https://overpass-api.de/api/interpreter"
    # OpenTripMap replaces Overpass for find_places when set. Sent in the query string, so the
    # URL is never logged.
    opentripmap_key: Annotated[SecretStr | None, BeforeValidator(_blank_to_none)] = None
    # Open-Meteo's free API (api.open-meteo.com, archive-api.open-meteo.com) is for non-commercial
    # use only. With a paid plan's key the weather tool uses the customer hosts
    # (customer-api.open-meteo.com, customer-archive-api.open-meteo.com; historical weather needs
    # the Professional plan or higher). Production without a key has no weather. The key travels
    # in the query string, so URLs are never logged.
    open_meteo_api_key: Annotated[SecretStr | None, BeforeValidator(_blank_to_none)] = None
    log_level: str = "INFO"
    # Bearer token for GET /metrics. Empty: /metrics is served only outside production.
    metrics_token: str = ""

    @model_validator(mode="after")
    def _google_api_key_fallback(self) -> Self:
        """A blank TM_GOOGLE_API_KEY= (as conftest and .env templates set) must not hide
        GOOGLE_API_KEY: an unset or blank TM key falls back to it."""
        if self.google_api_key is None:
            self.google_api_key = self.google_api_key_fallback
        return self

    @property
    def sandbox_supplier_enabled(self) -> bool:
        if self.sandbox_supplier is not None:
            return self.sandbox_supplier
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
