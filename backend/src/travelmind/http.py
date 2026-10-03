"""Shared outbound HTTP clients: one pooled httpx client per supplier or feed, per process.

Callers keep their own limits by passing `timeout=` on each request, and their own deadlines with
`asyncio.timeout`. Clients are created lazily and closed in the app lifespan.
"""

from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx

_clients: dict[str, httpx.AsyncClient] = {}
_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0)


def _no_cookies() -> CookieJar:
    # A shared client must not carry one caller's cookies (load balancer, session) into another's
    # requests, so its jar accepts none.
    return CookieJar(policy=DefaultCookiePolicy(allowed_domains=[]))


def get_http_client(name: str, *, timeout: httpx.Timeout, base_url: str = "") -> httpx.AsyncClient:
    """The shared client for `name`, created on first use with this default timeout/base URL."""
    client = _clients.get(name)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(
            timeout=timeout, base_url=base_url, limits=_LIMITS, cookies=_no_cookies()
        )
        _clients[name] = client
    return client


async def close_http_clients() -> None:
    """Close every shared client (shutdown). Later calls create fresh ones."""
    clients = list(_clients.values())
    _clients.clear()
    for client in clients:
        await client.aclose()
