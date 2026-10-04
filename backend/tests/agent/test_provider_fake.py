import asyncio

import pytest

from travelmind.agent.fake import FakeProvider
from travelmind.agent.gemini import GeminiProvider
from travelmind.agent.provider import (
    AgentUnavailable,
    Generation,
    Message,
    ProviderError,
    ToolCall,
    ToolResult,
    ToolSpec,
    get_provider,
)
from travelmind.config import Settings

CANARY = "AIza-canary-7d1e4b"  # distinctive, so a hit can only be a leak
SPEC = ToolSpec(
    name="lookup_airport",
    description="Find airports by city or code.",
    parameters={"type": "object", "properties": {"query": {"type": "string"}}},
)


def _settings(monkeypatch, *, key: str | None = None, alias: str = "TM_GOOGLE_API_KEY", **kw):
    for name in ("TM_GOOGLE_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    if key is not None:
        monkeypatch.setenv(alias, key)
    return Settings(_env_file=None, **kw)


async def _generate(provider, messages):  # type: ignore[no-untyped-def]
    return await provider.generate(system="sys", messages=messages, tools=[SPEC], timeout_s=5)


async def test_fake_provider_returns_its_script_in_order():
    call = ToolCall(id="c1", name="lookup_airport", args={"query": "Dubai"})
    provider = FakeProvider(
        [
            Generation(text=None, calls=(call,), input_tokens=10, output_tokens=2),
            lambda messages: Generation(
                text=f"{len(messages)} messages", calls=(), input_tokens=5, output_tokens=3
            ),
        ]
    )
    first = await _generate(provider, [Message(role="user", text="Plan Dubai")])
    assert first.calls == (call,) and first.input_tokens == 10
    history = [
        Message(role="user", text="Plan Dubai"),
        Message(role="model", calls=(call,)),
        Message(role="tool", results=(ToolResult(call_id="c1", name="lookup_airport", data={}),)),
    ]
    second = await _generate(provider, history)
    assert second.text == "3 messages" and second.calls == ()
    assert [len(r.messages) for r in provider.requests] == [1, 3]
    assert provider.requests[0].system == "sys" and provider.requests[0].tools == (SPEC,)
    assert provider.name == "fake"


async def test_fake_provider_can_raise_and_await():
    async def slow(messages):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0)
        return Generation(text="late", calls=(), input_tokens=0, output_tokens=0)

    provider = FakeProvider([ProviderError("timeout"), slow])
    with pytest.raises(ProviderError) as caught:
        await _generate(provider, [Message(role="user", text="hi")])
    assert caught.value.kind == "timeout"
    assert (await _generate(provider, [Message(role="user", text="hi")])).text == "late"


async def test_an_exhausted_script_is_an_invalid_turn():
    provider = FakeProvider([])
    with pytest.raises(ProviderError) as caught:
        await _generate(provider, [Message(role="user", text="hi")])
    assert caught.value.kind == "invalid"


def test_planner_is_a_fake_provider_labelled_as_the_demo_planner():
    planner = FakeProvider.planner()
    assert planner.name == "fake" and planner.model == "demo-planner"


def test_auto_uses_gemini_when_a_key_is_set(monkeypatch):
    provider = get_provider(_settings(monkeypatch, key=CANARY))
    assert isinstance(provider, GeminiProvider)
    assert provider.name == "gemini" and provider.model == "gemini-2.5-flash"


def test_the_key_falls_back_to_google_api_key(monkeypatch):
    settings = _settings(monkeypatch, key=CANARY, alias="GOOGLE_API_KEY")
    assert settings.google_api_key is not None
    assert settings.google_api_key.get_secret_value() == CANARY
    assert isinstance(get_provider(settings), GeminiProvider)


def test_the_tm_key_wins_over_the_fallback(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "plain-key")
    monkeypatch.setenv("TM_GOOGLE_API_KEY", "tm-key")
    settings = Settings(_env_file=None)
    assert settings.google_api_key is not None
    assert settings.google_api_key.get_secret_value() == "tm-key"


def test_auto_uses_the_demo_planner_without_a_key(monkeypatch):
    for environment in ("development", "test"):
        provider = get_provider(_settings(monkeypatch, environment=environment))
        assert isinstance(provider, FakeProvider) and provider.model == "demo-planner"


def test_a_blank_key_counts_as_no_key(monkeypatch):
    settings = _settings(monkeypatch, key="  ")
    assert settings.google_api_key is None
    assert isinstance(get_provider(settings), FakeProvider)


def test_production_without_a_key_is_unavailable(monkeypatch):
    with pytest.raises(AgentUnavailable):
        get_provider(_settings(monkeypatch, environment="production"))


def test_production_never_uses_the_fake_provider(monkeypatch):
    settings = _settings(monkeypatch, key=CANARY, environment="production", agent_provider="fake")
    with pytest.raises(AgentUnavailable):
        get_provider(settings)


def test_explicit_choices(monkeypatch):
    assert isinstance(
        get_provider(_settings(monkeypatch, key=CANARY, agent_provider="fake")), FakeProvider
    )
    with pytest.raises(AgentUnavailable):
        get_provider(_settings(monkeypatch, agent_provider="gemini"))


def test_the_model_id_comes_from_settings(monkeypatch):
    provider = get_provider(_settings(monkeypatch, key=CANARY, agent_model="gemini-x-test"))
    assert provider.model == "gemini-x-test"


def test_agent_settings_defaults(monkeypatch):
    settings = _settings(monkeypatch)
    assert settings.agent_provider == "auto"
    assert settings.agent_model == "gemini-2.5-flash"
    assert settings.agent_max_steps == 12
    assert settings.agent_step_timeout_s == 20
    assert settings.agent_run_timeout_s == 120
    assert settings.agent_run_token_cap == 60_000
    assert settings.agent_monthly_token_budget == 2_000_000
    assert settings.agent_max_concurrent_runs_per_agency == 3


def test_the_key_never_appears_in_settings_reprs(monkeypatch):
    settings = _settings(monkeypatch, key=CANARY)
    provider = get_provider(settings)
    for text in (repr(settings), str(settings), repr(settings.model_dump()), repr(provider)):
        assert CANARY not in text


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_tm_key_falls_back_to_google_api_key(monkeypatch, blank):
    monkeypatch.setenv("TM_GOOGLE_API_KEY", blank)
    monkeypatch.setenv("GOOGLE_API_KEY", CANARY)
    settings = Settings(_env_file=None)
    assert settings.google_api_key is not None
    assert settings.google_api_key.get_secret_value() == CANARY
    assert isinstance(get_provider(settings), GeminiProvider)
    assert CANARY not in repr(settings) and CANARY not in str(settings.model_dump())


def test_both_keys_blank_is_no_key(monkeypatch):
    monkeypatch.setenv("TM_GOOGLE_API_KEY", "")
    monkeypatch.setenv("GOOGLE_API_KEY", " ")
    settings = Settings(_env_file=None)
    assert settings.google_api_key is None
    assert isinstance(get_provider(settings), FakeProvider)


def test_the_key_can_be_passed_directly(monkeypatch):
    for name in ("TM_GOOGLE_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None, google_api_key=CANARY)
    assert settings.google_api_key is not None
    assert settings.google_api_key.get_secret_value() == CANARY
