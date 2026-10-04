"""Gemini provider: mapping to and from google-genai types, and its outbound guard. No network:
the HTTP endpoint is mocked with respx."""

import asyncio
import base64
import json

import httpx
import pytest
from google.genai import _extra_utils, errors, types
from prometheus_client import REGISTRY

from travelmind.agent import gemini
from travelmind.agent.gemini import (
    GeminiProvider,
    build_config,
    from_response,
    map_error,
    to_contents,
    to_tools,
)
from travelmind.agent.provider import (
    Generation,
    Message,
    ProviderError,
    ToolCall,
    ToolResult,
    ToolSpec,
)
from travelmind.config import get_settings
from travelmind.resilience import GUARDED_SUPPLIERS, guard_for

MODEL = "gemini-2.5-flash"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
KEY = "test-key-not-real"
SPEC = ToolSpec(
    name="lookup_airport",
    description="Find airports by city or code.",
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
)
CALL = ToolCall(id="call-1", name="lookup_airport", args={"query": "Dubai"})
RESULT = ToolResult(
    call_id="call-1", name="lookup_airport", data={"matches": [{"code": "DXB", "name": "Dubai"}]}
)


def _count(outcome: str) -> float:
    value = REGISTRY.get_sample_value(
        "supplier_request_duration_seconds_count", {"supplier": "gemini", "outcome": outcome}
    )
    return value or 0.0


def _response(parts: list[dict], usage: dict | None = None) -> dict:
    body: dict = {"candidates": [{"content": {"role": "model", "parts": parts}}]}
    if usage is not None:
        body["usageMetadata"] = usage
    return body


async def _generate(provider: GeminiProvider, messages=None) -> Generation:  # type: ignore[no-untyped-def]
    return await provider.generate(
        system="You plan trips.",
        messages=messages or [Message(role="user", text="Mumbai to Dubai")],
        tools=[SPEC],
        timeout_s=5,
    )


# --- pure mapping ------------------------------------------------------------------------


def test_messages_map_to_contents():
    signature = base64.b64encode(b"opaque").decode()
    signed = ToolCall(
        id="call-1", name="lookup_airport", args={"query": "Dubai"}, signature=signature
    )
    contents = to_contents(
        [
            Message(role="user", text="Mumbai to Dubai"),
            Message(role="model", text="Looking that up.", calls=(signed,)),
            Message(role="tool", results=(RESULT,)),
        ]
    )
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[0].parts == [types.Part(text="Mumbai to Dubai")]
    text_part, call_part = contents[1].parts or []
    assert text_part.text == "Looking that up."
    assert call_part.function_call == types.FunctionCall(
        id="call-1", name="lookup_airport", args={"query": "Dubai"}
    )
    assert call_part.thought_signature == b"opaque"
    [result_part] = contents[2].parts or []
    response = result_part.function_response
    assert response is not None
    assert response.id == "call-1" and response.name == "lookup_airport"
    # tool output reaches the model only as data, inside the function response
    assert response.response == {"data": {"matches": [{"code": "DXB", "name": "Dubai"}]}}


def test_locally_numbered_calls_are_sent_without_an_id():
    local = ToolCall(id=gemini.LOCAL_ID_PREFIX + "abc", name="lookup_airport", args={"query": "x"})
    result = ToolResult(call_id=local.id, name="lookup_airport", data={})
    model, tool = to_contents(
        [Message(role="model", calls=(local,)), Message(role="tool", results=(result,))]
    )
    assert (model.parts or [])[0].function_call.id is None  # type: ignore[union-attr]
    assert (tool.parts or [])[0].function_response.id is None  # type: ignore[union-attr]


def test_tool_specs_map_to_function_declarations():
    [tool] = to_tools([SPEC])
    [declaration] = tool.function_declarations or []
    assert declaration.name == "lookup_airport"
    assert declaration.description == "Find airports by city or code."
    assert declaration.parameters_json_schema == SPEC.parameters


def test_config_disables_automatic_function_calling():
    config = build_config(system="You plan trips.", tools=[SPEC], timeout_s=20)
    assert config.system_instruction == "You plan trips."
    assert config.automatic_function_calling == types.AutomaticFunctionCallingConfig(disable=True)
    assert _extra_utils.should_disable_afc(config) is True  # the SDK will not run tools itself
    assert config.http_options is not None and config.http_options.timeout == 20_000
    assert config.tools == to_tools([SPEC])
    assert build_config(system="s", tools=[], timeout_s=1).tools is None


def test_response_maps_to_a_generation():
    response = types.GenerateContentResponse.model_validate(
        _response(
            [
                {"text": "Checking "},
                {"text": "thinking out loud", "thought": True},
                {"text": "flights."},
                {
                    "functionCall": {
                        "id": "fc-9",
                        "name": "lookup_airport",
                        "args": {"query": "Dubai"},
                    },
                    "thoughtSignature": base64.b64encode(b"sig").decode(),
                },
                {"functionCall": {"name": "lookup_airport", "args": {"query": "Mumbai"}}},
            ],
            usage={
                "promptTokenCount": 120,
                "candidatesTokenCount": 15,
                "thoughtsTokenCount": 7,
                "totalTokenCount": 142,
            },
        )
    )
    generation = from_response(response)
    assert generation.text == "Checking flights."
    first, second = generation.calls
    assert first == ToolCall(
        id="fc-9",
        name="lookup_airport",
        args={"query": "Dubai"},
        signature=base64.b64encode(b"sig").decode(),
    )
    assert second.id.startswith(gemini.LOCAL_ID_PREFIX) and second.args == {"query": "Mumbai"}
    assert (generation.input_tokens, generation.output_tokens) == (120, 22)


def test_a_round_trip_keeps_the_call_and_its_result_paired():
    response = types.GenerateContentResponse.model_validate(
        _response(
            [{"functionCall": {"id": "fc-1", "name": "lookup_airport", "args": {"query": "Dubai"}}}]
        )
    )
    [call] = from_response(response).calls
    result = ToolResult(call_id=call.id, name=call.name, data={"matches": []})
    model, tool = to_contents(
        [Message(role="model", calls=(call,)), Message(role="tool", results=(result,))]
    )
    sent_call = (model.parts or [])[0].function_call
    sent_result = (tool.parts or [])[0].function_response
    assert sent_call is not None and sent_result is not None
    assert (sent_call.id, sent_call.name, sent_call.args) == (
        "fc-1",
        "lookup_airport",
        {"query": "Dubai"},
    )
    assert (sent_result.id, sent_result.name) == ("fc-1", "lookup_airport")


def test_an_empty_response_is_an_empty_generation():
    generation = from_response(types.GenerateContentResponse.model_validate({}))
    assert generation == Generation(text=None, calls=(), input_tokens=0, output_tokens=0)


def test_a_blocked_prompt_is_invalid():
    response = types.GenerateContentResponse.model_validate(
        {"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": {"promptTokenCount": 9}}
    )
    with pytest.raises(ProviderError) as caught:
        from_response(response)
    assert caught.value.kind == "invalid"


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (errors.ClientError(429, {"error": {"status": "RESOURCE_EXHAUSTED"}}), "rate_limited"),
        (errors.ClientError(400, {"error": {"status": "INVALID_ARGUMENT"}}), "invalid"),
        (errors.ClientError(404, {"error": {"status": "NOT_FOUND"}}), "invalid"),
        (errors.ClientError(401, {"error": {"status": "UNAUTHENTICATED"}}), "unavailable"),
        (errors.ClientError(403, {"error": {"status": "PERMISSION_DENIED"}}), "unavailable"),
        (errors.ServerError(500, {"error": {"status": "INTERNAL"}}), "unavailable"),
        (errors.ServerError(503, {"error": {"status": "UNAVAILABLE"}}), "unavailable"),
        (errors.ServerError(504, {"error": {"status": "DEADLINE_EXCEEDED"}}), "timeout"),
        (TimeoutError(), "timeout"),
        (httpx.ReadTimeout("slow"), "timeout"),
        (httpx.ConnectError("refused"), "unavailable"),
        (ValueError("odd"), "unavailable"),
    ],
)
def test_errors_map_to_provider_error_kinds(exc, kind):
    error = map_error(exc)
    assert isinstance(error, ProviderError) and error.kind == kind
    assert error.message  # safe to show


# --- the provider over (mocked) HTTP -----------------------------------------------------


def test_gemini_is_a_guarded_supplier():
    assert "gemini" in GUARDED_SUPPLIERS


async def test_generate_sends_one_request_and_reads_the_answer(respx_mock):
    route = respx_mock.post(ENDPOINT).mock(
        return_value=httpx.Response(
            200,
            json=_response(
                [{"functionCall": {"name": "lookup_airport", "args": {"query": "Dubai"}}}],
                usage={"promptTokenCount": 50, "candidatesTokenCount": 8},
            ),
        )
    )
    before = _count("ok")
    generation = await _generate(GeminiProvider(api_key=KEY, model=MODEL))
    assert [c.name for c in generation.calls] == ["lookup_airport"]
    assert (generation.input_tokens, generation.output_tokens) == (50, 8)
    assert route.call_count == 1
    request = route.calls[0].request
    assert request.headers["x-goog-api-key"] == KEY
    assert KEY not in str(request.url)
    body = json.loads(request.content)
    assert body["systemInstruction"]["parts"] == [{"text": "You plan trips."}]
    assert body["contents"] == [{"role": "user", "parts": [{"text": "Mumbai to Dubai"}]}]
    [declaration] = body["tools"][0]["functionDeclarations"]
    assert declaration["name"] == "lookup_airport"
    assert _count("ok") == before + 1


@pytest.mark.parametrize(
    ("status", "kind", "outcome"),
    [(429, "rate_limited", "error"), (500, "unavailable", "error"), (400, "invalid", "error")],
)
async def test_http_errors_become_provider_errors(respx_mock, status, kind, outcome):
    respx_mock.post(ENDPOINT).mock(
        return_value=httpx.Response(status, json={"error": {"code": status, "message": "no"}})
    )
    before = _count(outcome)
    with pytest.raises(ProviderError) as caught:
        await _generate(GeminiProvider(api_key=KEY, model=MODEL))
    assert caught.value.kind == kind
    assert _count(outcome) == before + 1


async def test_a_slow_answer_is_a_timeout(respx_mock):
    async def slow(request):  # type: ignore[no-untyped-def]
        await asyncio.sleep(1)
        return httpx.Response(200, json=_response([{"text": "late"}]))

    respx_mock.post(ENDPOINT).mock(side_effect=slow)
    before = _count("timeout")
    with pytest.raises(ProviderError) as caught:
        await GeminiProvider(api_key=KEY, model=MODEL).generate(
            system="s", messages=[Message(role="user", text="hi")], tools=[], timeout_s=0.05
        )
    assert caught.value.kind == "timeout"
    assert _count("timeout") == before + 1


async def test_repeated_failures_open_the_breaker_and_skip_gemini(respx_mock):
    route = respx_mock.post(ENDPOINT).mock(
        return_value=httpx.Response(503, json={"error": {"code": 503, "message": "down"}})
    )
    provider = GeminiProvider(api_key=KEY, model=MODEL)
    for _ in range(get_settings().supplier_breaker_threshold):
        with pytest.raises(ProviderError):
            await _generate(provider)
    assert guard_for("gemini").state == "open"
    calls = route.call_count
    with pytest.raises(ProviderError) as caught:
        await _generate(provider)
    assert caught.value.kind == "unavailable"
    assert route.call_count == calls  # skipped, not called


async def test_requests_we_got_wrong_keep_the_breaker_closed(respx_mock):
    respx_mock.post(ENDPOINT).mock(
        return_value=httpx.Response(400, json={"error": {"code": 400, "message": "bad"}})
    )
    provider = GeminiProvider(api_key=KEY, model=MODEL)
    for _ in range(get_settings().supplier_breaker_threshold + 1):
        with pytest.raises(ProviderError):
            await _generate(provider)
    assert guard_for("gemini").state == "closed"
