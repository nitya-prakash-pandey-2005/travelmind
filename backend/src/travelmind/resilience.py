"""Outbound resilience: a concurrency limit and a circuit breaker for each outbound supplier.

`guard_for(name)` returns the guard of one supplier (Duffel, LiteAPI, Google TIM, Travelpayouts,
ECB; the names are the supplier metrics labels). Callers wrap the whole outbound call, including
their own deadline, in `async with guard.call():`, so a call that runs out of time counts as a
failure:
- At most `supplier_max_concurrent` (20) calls to a supplier are in flight. A call that gets no
  slot within `supplier_acquire_timeout_s` (2 s) is refused with CircuitOpen (`reason="busy"`).
- After `supplier_breaker_threshold` (5) consecutive failures the breaker opens: for
  `supplier_breaker_reset_s` (30 s) every call is refused at once with CircuitOpen
  (`reason="open"`) and the supplier is not contacted. Then one trial call goes through
  (half-open) while the others are still refused; its success closes the breaker and its failure
  opens it for another 30 s.
- A failure is any exception from the call except a SupplierError that is about the request
  itself (`invalid_request`, `offer_expired`, `offer_unavailable`): the supplier answered, so it
  is healthy. Timeouts are failures. A cancelled call has no outcome; if it was the half-open
  trial, the next call becomes the trial.

Every caller turns CircuitOpen into its usual "unavailable" result, never a 500: flight and hotel
search mark the source `error` with the refusal's message, a price check fails as "couldn't
confirm the price" (502), and the CO2, FX and fare-history feeds return nothing, as when they are
down. A refusal is recorded as supplier outcome `circuit_open` with the time spent waiting.

The guards are per process. Each API worker (gunicorn) and the arq worker has its own registry,
so each worker has its own breaker and its own concurrency limit: with N workers a supplier sees
up to N x 20 concurrent calls, and each worker discovers an outage after its own 5 failures.
That keeps the breaker free of any shared state (Redis may be what is down), at the cost of a
few extra failed calls per worker.
"""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Literal

import structlog

from travelmind.config import get_settings
from travelmind.metrics import observe_supplier
from travelmind.offers.suppliers.base import SupplierError

__all__ = [
    "GUARDED_SUPPLIERS",
    "BreakerState",
    "CircuitBreaker",
    "CircuitOpen",
    "SupplierGuard",
    "breaker_state",
    "guard_for",
    "guarded",
    "reset_guards",
]

log = structlog.get_logger()

BreakerState = Literal["closed", "open", "half_open"]

# Outbound suppliers and feeds, by their metrics label. The sandbox runs in process: no guard.
GUARDED_SUPPLIERS = frozenset({"duffel", "liteapi", "google_tim", "travelpayouts", "ecb"})

# The supplier answered about this request: not a sign that it is unwell.
_REQUEST_ERRORS = frozenset({"invalid_request", "offer_expired", "offer_unavailable"})

_MESSAGES = {
    "open": "Paused after repeated failures. Trying again shortly.",
    "busy": "Too many requests to this supplier right now. Try again shortly.",
}


class CircuitBreaker:
    """Consecutive-failure breaker. Closed: every call goes through. After `failures`
    consecutive failures it opens and refuses calls for `cooldown_s`; then one trial call goes
    through (half-open) while the others keep being refused, and its outcome closes or reopens
    it. Single event loop, so no locking."""

    def __init__(
        self, *, failures: int, cooldown_s: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._threshold = max(1, failures)
        self._cooldown_s = cooldown_s
        self._clock = clock
        self._failures = 0
        self._open_until: float | None = None
        self._trial = False

    @property
    def state(self) -> BreakerState:
        if self._open_until is None:
            return "closed"
        if self._trial or self._clock() >= self._open_until:
            return "half_open"
        return "open"

    def allow(self) -> bool:
        if self._open_until is None:
            return True
        if self._trial or self._clock() < self._open_until:
            return False
        self._trial = True
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._open_until = None
        self._trial = False

    def record_failure(self) -> bool:
        """Count a failure; True when it opened the breaker (closed or half-open to open)."""
        self._failures += 1
        if self._trial or (self._open_until is None and self._failures >= self._threshold):
            self._trial = False
            self._open_until = self._clock() + self._cooldown_s
            return True
        return False

    def abandon(self) -> None:
        """A call ended without an outcome (cancelled, say): let another trial through."""
        self._trial = False


class CircuitOpen(Exception):
    """The guard refused the call: the breaker is open (`reason="open"`) or no slot came free
    in time (`reason="busy"`). The supplier was not contacted. `message` is safe to show."""

    def __init__(self, supplier: str, reason: Literal["open", "busy"]) -> None:
        self.supplier = supplier
        self.reason: Literal["open", "busy"] = reason
        self.message = _MESSAGES[reason]
        super().__init__(f"{supplier}: {self.message}")


def _is_failure(exc: BaseException) -> bool:
    return not (isinstance(exc, SupplierError) and exc.code in _REQUEST_ERRORS)


class SupplierGuard:
    """Per-process guard for one supplier: at most `max_concurrent` calls in flight, and a circuit
    breaker that opens after `failure_threshold` consecutive failures/timeouts and lets one trial
    call through after `reset_after_s` (half-open). Time comes from an injectable clock."""

    def __init__(
        self,
        name: str,
        *,
        max_concurrent: int,
        failure_threshold: int = 5,
        reset_after_s: float = 30.0,
        acquire_timeout_s: float = 2.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.name = name
        self.max_concurrent = max(1, max_concurrent)
        self.failure_threshold = max(1, failure_threshold)
        self.reset_after_s = reset_after_s
        self.acquire_timeout_s = acquire_timeout_s
        self._breaker = CircuitBreaker(
            failures=self.failure_threshold, cooldown_s=reset_after_s, clock=clock
        )
        self._slots = asyncio.Semaphore(self.max_concurrent)

    @property
    def state(self) -> BreakerState:
        return self._breaker.state

    @asynccontextmanager
    async def call(self) -> AsyncIterator[None]:
        """Raises CircuitOpen when open (or when no slot frees within acquire_timeout_s);
        records success/failure from the body's outcome (exceptions = failure)."""
        trial = self._breaker.state != "closed"
        if not self._breaker.allow():
            self._refuse("open", 0.0)
        started = time.perf_counter()
        try:
            await self._acquire_slot()
        except TimeoutError:
            if trial:
                self._breaker.abandon()
            self._refuse("busy", time.perf_counter() - started)
        except BaseException:
            if trial:
                self._breaker.abandon()
            raise
        try:
            yield
        except (asyncio.CancelledError, GeneratorExit):
            if trial:
                self._breaker.abandon()
            raise
        except BaseException as exc:
            if _is_failure(exc):
                self._failed(exc)
            else:
                self._succeeded()
            raise
        else:
            self._succeeded()
        finally:
            self._slots.release()

    async def _acquire_slot(self) -> None:
        if not self._slots.locked():
            await self._slots.acquire()  # a free slot: returns at once
            return
        if self.acquire_timeout_s <= 0:
            raise TimeoutError
        async with asyncio.timeout(self.acquire_timeout_s):
            await self._slots.acquire()

    def _refuse(self, reason: Literal["open", "busy"], waited_s: float) -> None:
        observe_supplier(self.name, "circuit_open", waited_s)
        raise CircuitOpen(self.name, reason)

    def _succeeded(self) -> None:
        recovering = self._breaker.state != "closed"
        self._breaker.record_success()
        if recovering:
            log.info("supplier_circuit_closed", supplier=self.name)

    def _failed(self, exc: BaseException) -> None:
        if self._breaker.record_failure():
            log.warning(
                "supplier_circuit_open",
                supplier=self.name,
                error_type=type(exc).__name__,
                retry_in_s=self.reset_after_s,
            )


_guards: dict[str, SupplierGuard] = {}


def guard_for(name: str) -> SupplierGuard:
    """This process's guard for supplier `name`, made on first use from settings."""
    guard = _guards.get(name)
    if guard is None:
        settings = get_settings()
        guard = _guards[name] = SupplierGuard(
            name,
            max_concurrent=settings.supplier_max_concurrent,
            failure_threshold=settings.supplier_breaker_threshold,
            reset_after_s=settings.supplier_breaker_reset_s,
            acquire_timeout_s=settings.supplier_acquire_timeout_s,
        )
    return guard


def guarded(name: str) -> AbstractAsyncContextManager[None]:
    """`guard_for(name).call()` for an outbound supplier; nothing for an in-process one (the
    sandbox, or a test double)."""
    if name in GUARDED_SUPPLIERS:
        return guard_for(name).call()
    return contextlib.nullcontext()


def breaker_state(name: str) -> BreakerState:
    """The breaker state of `name` in this process (`closed` before its first call)."""
    guard = _guards.get(name)
    return guard.state if guard is not None else "closed"


def reset_guards() -> None:
    """Forget every guard (tests; the next call builds fresh ones from settings)."""
    _guards.clear()
