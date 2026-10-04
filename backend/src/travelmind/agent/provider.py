"""The model interface the agent loop talks to, and the message types it speaks.

A conversation is a sequence of `Message`s: the user's text, the model's turns (text and/or tool
calls) and tool results. Tool results travel back to the model as data (`ToolResult.data`, a
JSON-safe dict the tool has already trimmed), never as instructions. A provider turns the
conversation into one `Generation`: the model's text, the tool calls it wants and the tokens the
turn cost. The engine runs the tools and the loop; providers never call tools themselves.

`get_provider(settings)` picks the provider for this environment: Gemini when a key is set, the
rule-based demo planner otherwise, and never the demo planner in production, where the agent is
unavailable without a key.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from travelmind.config import Settings
from travelmind.offers.suppliers.base import ErrorCode, SupplierError

Role = Literal["user", "model", "tool"]
ProviderErrorKind = Literal["timeout", "rate_limited", "unavailable", "invalid"]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]
    # Opaque provider state to send back with the call on later turns (Gemini's thought
    # signature, base64). Not part of the call's identity.
    signature: str | None = field(default=None, compare=False, repr=False)


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    data: dict[str, Any]  # JSON-safe, already trimmed


@dataclass(frozen=True)
class Message:
    role: Role
    text: str | None = None
    calls: tuple[ToolCall, ...] = ()
    results: tuple[ToolResult, ...] = ()
    # A model turn's opaque provider state for its text (Gemini's thought signature, base64),
    # sent back with the text on later turns. Not part of the message's identity.
    text_signature: str | None = field(default=None, compare=False, repr=False)
    # A user-role message the engine wrote (the grounding re-prompt): the model reads it as the
    # user's turn, but it is never what the user said (the demo planner's intents and trip, the
    # guard's stated facts).
    engine: bool = False


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema


@dataclass(frozen=True)
class Generation:
    text: str | None
    calls: tuple[ToolCall, ...]
    input_tokens: int
    output_tokens: int
    finish_reason: str | None = None  # the provider's own word for why the turn ended ("STOP")
    # Opaque provider state for `text` (see Message.text_signature): the engine copies it onto
    # the model Message it records. Not part of the generation's identity.
    text_signature: str | None = field(default=None, compare=False, repr=False)


class LLMProvider(Protocol):
    name: str
    model: str

    async def generate(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
        timeout_s: float,
    ) -> Generation: ...


_MESSAGES: dict[ProviderErrorKind, str] = {
    "timeout": "The planning model took too long to answer.",
    "rate_limited": "The planning model is busy right now. Try again shortly.",
    "unavailable": "The planning model is unavailable right now. Try again shortly.",
    "invalid": "The planning model could not handle this request.",
}
# As a SupplierError, the supplier guard and metrics read the outcome: a timeout is timed as one,
# and a request the model rejected ("invalid") leaves the breaker closed.
_CODES: dict[ProviderErrorKind, ErrorCode] = {
    "timeout": "timeout",
    "rate_limited": "rate_limited",
    "unavailable": "unavailable",
    "invalid": "invalid_request",
}


class ProviderError(SupplierError):
    """A model call failed. `kind` says how; `message` is safe to show (it never carries the
    provider's own error text, which may echo the request). `input_tokens` and `output_tokens`
    are what the failed call still cost (a blocked prompt is billed for its input), for the
    engine to record against the budget like any other call."""

    def __init__(
        self,
        kind: ProviderErrorKind,
        message: str | None = None,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        super().__init__(_CODES[kind], message or _MESSAGES[kind])
        self.kind: ProviderErrorKind = kind
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class AgentUnavailable(Exception):
    """No model is configured for this environment ("Agent unavailable — no model configured")."""

    message = "Agent unavailable — no model configured."

    def __init__(self) -> None:
        super().__init__(self.message)


def get_provider(settings: Settings) -> LLMProvider:
    """The provider `settings.agent_provider` selects. "auto" is Gemini when a key is set and the
    demo planner otherwise. Raises AgentUnavailable for Gemini without a key, and for the demo
    planner in production."""
    from travelmind.agent.fake import FakeProvider
    from travelmind.agent.gemini import GeminiProvider

    choice = settings.agent_provider
    key = settings.google_api_key
    if choice == "auto":
        choice = "gemini" if key is not None else "fake"
    if choice == "gemini":
        if key is None:
            raise AgentUnavailable
        return GeminiProvider(api_key=key, model=settings.agent_model)
    if settings.environment == "production":
        raise AgentUnavailable
    return FakeProvider.planner()
