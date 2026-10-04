"""A deterministic provider: scripted turns for tests and evals, or the rule-based demo planner.

`FakeProvider(script)` answers each `generate` with the next script item, in order:
- a `Generation`, returned as is;
- an exception instance, raised (a timeout or an unavailable model, say);
- a callable taking the conversation and returning a Generation (or an awaitable of one, for a
  turn that should take time).
Every request is recorded in `requests`. Past the end of the script it answers from `responder`,
or fails with ProviderError("invalid").

`FakeProvider.planner()` is the demo planner (`travelmind.agent.planner`): it keeps the agent
working without a model key in development and e2e, and runs are labelled "Demo planner". It is
never used in production.
"""

import inspect
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from travelmind.agent import planner
from travelmind.agent.provider import Generation, Message, ProviderError, ToolSpec

Responder = Callable[[Sequence[Message]], Generation | Awaitable[Generation]]
ScriptItem = Generation | BaseException | Responder

DEMO_PLANNER_MODEL = "demo-planner"


@dataclass(frozen=True)
class FakeRequest:
    system: str
    messages: tuple[Message, ...]
    tools: tuple[ToolSpec, ...]
    timeout_s: float


def _utc_today() -> date:
    return datetime.now(UTC).date()


class FakeProvider:
    name = "fake"

    def __init__(
        self,
        script: Sequence[ScriptItem] = (),
        *,
        model: str = "scripted",
        responder: Responder | None = None,
    ) -> None:
        self.model = model
        self._script: deque[ScriptItem] = deque(script)
        self._responder = responder
        self.requests: list[FakeRequest] = []

    @classmethod
    def planner(cls, *, today: Callable[[], date] = _utc_today) -> "FakeProvider":
        """The rule-based demo planner. `today` anchors relative dates ("next Friday")."""
        return cls(
            model=DEMO_PLANNER_MODEL,
            responder=lambda messages: planner.plan_turn(messages, today()),
        )

    async def generate(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
        timeout_s: float,
    ) -> Generation:
        self.requests.append(FakeRequest(system, tuple(messages), tuple(tools), timeout_s))
        item: ScriptItem
        if self._script:
            item = self._script.popleft()
        elif self._responder is not None:
            item = self._responder
        else:
            raise ProviderError("invalid", "The scripted conversation has no more turns.")
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, Generation):
            return item
        answer = item(messages)
        if inspect.isawaitable(answer):
            return await answer
        return answer
