"""Gemini through the official google-genai SDK (`client.aio.models.generate_content`).

The engine runs the tool loop, so the SDK's automatic function calling is disabled: a turn's
function calls come back to the engine as `ToolCall`s, and their results go back to the model as
`function_response` parts whose `response` is `{"data": <tool output>}`. Tool output is data in
its own part, never text in the instructions.

Each call goes through the "gemini" supplier guard (concurrency limit and circuit breaker) and is
timed as supplier "gemini". Errors become `ProviderError(kind=...)`. The key is sent only in the
SDK's `x-goog-api-key` header; it is never logged, put in a label or in an error message.

One SDK client per key per process, made on first use (building one costs ~20 ms and opens its
own HTTP pool); `close_clients()` closes them at shutdown. The client is pinned to the Gemini
Developer API at GEMINI_BASE_URL: environment variables the SDK would otherwise read
(GOOGLE_GENAI_USE_VERTEXAI/_ENTERPRISE, GOOGLE_GEMINI_BASE_URL, GOOGLE_GENAI_CLIENT_MODE, ...)
cannot send the key or the conversation anywhere else. The key stays a SecretStr until the
client is built.
"""

import asyncio
import base64
import hashlib
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

import httpx
import structlog
from google import genai
from google.genai import errors, types
from google.genai.client import DebugConfig
from pydantic import SecretStr

from travelmind.agent.provider import (
    Generation,
    Message,
    ProviderError,
    ProviderErrorKind,
    ToolCall,
    ToolResult,
    ToolSpec,
)
from travelmind.metrics import supplier_call
from travelmind.resilience import CircuitOpen, guarded

log = structlog.get_logger()

SUPPLIER = "gemini"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/"
# Gemini may return a function call without an id. The engine still needs one to pair the call
# with its result, so it numbers the call itself; such ids are never sent back to the model.
LOCAL_ID_PREFIX = "local-"

_clients: dict[str, genai.Client] = {}


def _client(api_key: SecretStr) -> genai.Client:
    secret = api_key.get_secret_value()
    slot = hashlib.sha256(secret.encode()).hexdigest()
    client = _clients.get(slot)
    if client is None:
        client = _clients[slot] = genai.Client(
            api_key=secret,
            vertexai=False,  # explicit, so GOOGLE_GENAI_USE_VERTEXAI/_ENTERPRISE are not read
            http_options=types.HttpOptions(base_url=GEMINI_BASE_URL),  # over GOOGLE_*_BASE_URL
            # explicit, so GOOGLE_GENAI_CLIENT_MODE can't swap in the record/replay client
            debug_config=DebugConfig(client_mode=None, replays_directory=None, replay_id=None),
        )
    return client


async def close_clients() -> None:
    """Close every SDK client (shutdown, and between tests: each holds an HTTP pool bound to the
    event loop that used it). Later calls make fresh ones."""
    clients = list(_clients.values())
    _clients.clear()
    for client in clients:
        try:
            await client.aio.aclose()
            client.close()
        except Exception as exc:
            log.warning("gemini_client_close_failed", error_type=type(exc).__name__)


# --- mapping -----------------------------------------------------------------------------


def _wire_id(call_id: str) -> str | None:
    return None if call_id.startswith(LOCAL_ID_PREFIX) else call_id


def _call_part(call: ToolCall) -> types.Part:
    return types.Part(
        function_call=types.FunctionCall(id=_wire_id(call.id), name=call.name, args=call.args),
        thought_signature=base64.b64decode(call.signature) if call.signature else None,
    )


def _result_part(result: ToolResult) -> types.Part:
    return types.Part(
        function_response=types.FunctionResponse(
            id=_wire_id(result.call_id), name=result.name, response={"data": result.data}
        )
    )


def to_contents(messages: Sequence[Message]) -> list[types.Content]:
    """The conversation as Gemini contents. Tool results are sent in a user-role turn of
    function_response parts (the Gemini API's convention)."""
    contents: list[types.Content] = []
    for message in messages:
        parts: list[types.Part] = []
        if message.text:
            signature = message.text_signature
            parts.append(
                types.Part(
                    text=message.text,
                    thought_signature=base64.b64decode(signature) if signature else None,
                )
            )
        parts += [_call_part(call) for call in message.calls]
        parts += [_result_part(result) for result in message.results]
        if parts:
            role = "model" if message.role == "model" else "user"
            contents.append(types.Content(role=role, parts=parts))
    return contents


def to_tools(specs: Sequence[ToolSpec]) -> list[types.Tool]:
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name=spec.name,
                    description=spec.description,
                    parameters_json_schema=spec.parameters,
                )
                for spec in specs
            ]
        )
    ]


def build_config(
    *, system: str, tools: Sequence[ToolSpec], timeout_s: float
) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=system,
        tools=to_tools(tools) if tools else None,  # type: ignore[arg-type]
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        http_options=types.HttpOptions(timeout=max(1, round(timeout_s * 1000))),
    )


def _tokens(value: int | None) -> int:
    return int(value or 0)


_DECLINED = "The planning model declined this request."
# Finish reasons whose turn can't be used: an unusable tool call, or an answer withheld as unsafe.
# Safe messages only: the reason itself stays in our logs, not in what the user is shown.
_REJECTED_FINISH: dict[str, str] = {
    "MALFORMED_FUNCTION_CALL": "The planning model gave an answer it could not use.",
    "SAFETY": _DECLINED,
    "PROHIBITED_CONTENT": _DECLINED,
    "BLOCKLIST": _DECLINED,
    "SPII": _DECLINED,
}


def _b64(value: bytes | None) -> str | None:
    return base64.b64encode(value).decode() if value else None


def from_response(response: types.GenerateContentResponse) -> Generation:
    """The first candidate as a Generation. Thought-summary parts are not part of the answer.
    Output tokens include thinking tokens (billed as output). A blocked prompt, a malformed tool
    call or an answer withheld for safety raises ProviderError("invalid") carrying the tokens the
    call still cost."""
    usage = response.usage_metadata
    input_tokens = output_tokens = 0
    if usage is not None:
        input_tokens = _tokens(usage.prompt_token_count) + _tokens(
            usage.tool_use_prompt_token_count
        )
        output_tokens = _tokens(usage.candidates_token_count) + _tokens(usage.thoughts_token_count)
    cost = {"input_tokens": input_tokens, "output_tokens": output_tokens}
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason is not None:
        raise ProviderError("invalid", _DECLINED, **cost)
    candidates = response.candidates or []
    candidate = candidates[0] if candidates else None
    reason = candidate.finish_reason if candidate is not None else None
    finish_reason = str(reason.value) if reason is not None else None
    if finish_reason in _REJECTED_FINISH:
        raise ProviderError("invalid", _REJECTED_FINISH[finish_reason], **cost)
    texts: list[str] = []
    text_signature: str | None = None
    calls: list[ToolCall] = []
    content = candidate.content if candidate is not None else None
    for part in (content.parts if content is not None else None) or []:
        if part.function_call is not None:
            call = part.function_call
            calls.append(
                ToolCall(
                    id=call.id or f"{LOCAL_ID_PREFIX}{uuid4().hex[:12]}",
                    name=call.name or "",
                    args=dict(call.args or {}),
                    signature=_b64(part.thought_signature),
                )
            )
            continue
        # A signature on a text part (or a thought part) belongs with the turn's text: the
        # answer is sent back as one text part, carrying the first signature.
        text_signature = text_signature or _b64(part.thought_signature)
        if part.text and not part.thought:
            texts.append(part.text)
    return Generation(
        text="".join(texts) or None,
        calls=tuple(calls),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        finish_reason=finish_reason,
        text_signature=text_signature,
    )


_TIMEOUT_STATUSES = frozenset({408, 504})


# 400s that are about us, not the request: a bad key (INVALID_ARGUMENT with reason
# API_KEY_INVALID), or billing / an unsupported region (FAILED_PRECONDITION). Retrying the same
# request elsewhere won't help, and the breaker should count them.
_OUR_400_STATUSES = frozenset({"FAILED_PRECONDITION"})
_OUR_400_REASONS = frozenset({"API_KEY_INVALID"})


def _error_reasons(details: Any) -> set[str]:
    """The `reason`s of a Google API error body's `error.details` (google.rpc.ErrorInfo)."""
    error = details.get("error", details) if isinstance(details, dict) else None
    items = error.get("details") if isinstance(error, dict) else None
    if not isinstance(items, list):
        return set()
    return {str(item["reason"]) for item in items if isinstance(item, dict) and "reason" in item}


def _api_kind(exc: errors.APIError) -> ProviderErrorKind:
    code = exc.code
    if code == 429:
        return "rate_limited"
    if code in _TIMEOUT_STATUSES:
        return "timeout"
    if code in (401, 403) or code >= 500:
        return "unavailable"  # our credentials, or Gemini itself
    if code == 400 and (
        exc.status in _OUR_400_STATUSES or _error_reasons(exc.details) & _OUR_400_REASONS
    ):
        return "unavailable"  # our key, billing or region
    return "invalid"  # 4xx: the request itself (bad schema, unknown model)


def map_error(exc: BaseException) -> ProviderError:
    """A failed call as a ProviderError. Only the type and status are kept, never the text."""
    kind: ProviderErrorKind
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, errors.APIError):
        kind = _api_kind(exc)
    elif isinstance(exc, TimeoutError | httpx.TimeoutException):
        kind = "timeout"
    else:
        kind = "unavailable"
    return ProviderError(kind)


# --- the provider ------------------------------------------------------------------------


class GeminiProvider:
    name = "gemini"

    def __init__(self, *, api_key: SecretStr, model: str) -> None:
        self.model = model
        self._api_key = api_key  # unwrapped only to build the SDK client (_client)

    def __repr__(self) -> str:
        return f"GeminiProvider(model={self.model!r})"

    async def generate(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec],
        timeout_s: float,
    ) -> Generation:
        contents: Any = to_contents(messages)
        config = build_config(system=system, tools=tools, timeout_s=timeout_s)
        try:
            async with guarded(SUPPLIER):  # outside the deadline: a timeout is a failure
                with supplier_call(SUPPLIER):
                    try:
                        async with asyncio.timeout(timeout_s):
                            response = await _client(self._api_key).aio.models.generate_content(
                                model=self.model, contents=contents, config=config
                            )
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        error = map_error(exc)
                        log.warning(
                            "gemini_call_failed",
                            kind=error.kind,
                            error_type=type(exc).__name__,
                            status=getattr(exc, "code", None),
                        )
                        raise error from None
                    return from_response(response)
        except CircuitOpen as exc:  # skipped, not called
            raise ProviderError("unavailable", exc.message) from None
