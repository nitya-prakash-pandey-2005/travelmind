"""Shared outbound HTTP clients: one pooled httpx client per supplier or feed, per process.

A client is created by the first caller for its name, and that caller's `timeout` and `base_url`
become the client's defaults; later callers' values are ignored. So callers must pass `timeout=`
on every request and use absolute URLs, and keep their own deadlines with `asyncio.timeout`.

Clients are bound to the event loop that opened them. They are closed in the app lifespan; a
script that calls `asyncio.run` more than once must `await close_http_clients()` (and
`close_redis()`, and dispose the engine) before each run ends.
"""

from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx
import structlog

log = structlog.get_logger()

_clients: dict[str, httpx.AsyncClient] = {}
_base_urls: dict[str, str] = {}  # the base URL each client was created with, as given
_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0)


def _no_cookies() -> CookieJar:
    # A shared client must not carry one caller's cookies (load balancer, session) into another's
    # requests, so its jar accepts none.
    return CookieJar(policy=DefaultCookiePolicy(allowed_domains=[]))


def get_http_client(name: str, *, timeout: httpx.Timeout, base_url: str = "") -> httpx.AsyncClient:
    """The shared client for `name`. The first caller's timeout and base URL win (see the module
    docstring); a different base URL for an existing name is logged, as it would be ignored."""
    client = _clients.get(name)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(
            timeout=timeout, base_url=base_url, limits=_LIMITS, cookies=_no_cookies()
        )
        _clients[name] = client
        _base_urls[name] = base_url
    elif base_url != _base_urls.get(name):
        log.warning("http_client_base_url_mismatch", client=name)
    return client


async def close_http_clients() -> None:
    """Close every shared client (shutdown). One failing close doesn't stop the others; it is
    logged. Later calls create fresh clients."""
    clients = list(_clients.items())
    _clients.clear()
    _base_urls.clear()
    for name, client in clients:
        try:
            await client.aclose()
        except Exception as exc:
            log.warning("http_client_close_failed", client=name, error_type=type(exc).__name__)
