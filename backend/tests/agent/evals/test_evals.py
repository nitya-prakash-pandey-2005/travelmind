"""The agent evaluation suite: its cases, the report, the command, and the suite itself run
against the real loop and tools (sandbox supplier, mocked feeds), which must meet its
thresholds. A deliberately broken guard must make the grounding evals fail."""

import json
import os
from collections import Counter
from datetime import date

import pytest

from travelmind.agent import evals, loop
from travelmind.agent.evals import CaseResult, Report

CASES = evals.load_cases()
SIZES = {
    "extraction": 12,
    "clarification": 8,
    "tool_choice": 10,
    "grounding": 10,
    "injection": 6,
    "safety": 3,
    "limits": 3,
}


def test_the_suite_has_every_category_at_its_planned_size():
    assert Counter(case.category for case in CASES) == SIZES
    assert len(CASES) >= 50
    assert evals.THRESHOLDS["grounding"] == evals.THRESHOLDS["injection"] == 1.0
    assert all(evals.THRESHOLDS[c] >= 0.9 for c in SIZES)


def test_case_dates_are_filled_from_the_agency_today():
    today = date(2026, 10, 4)  # a Sunday
    assert evals.eval_day("+30", today) == date(2026, 11, 3)
    assert evals.eval_day("m2d12", today) == date(2026, 12, 12)
    assert evals.eval_day("m3d12", today) == date(2027, 1, 12)
    assert evals.eval_day("nextfri", today) == date(2026, 10, 9)
    filled = evals.fill_dates({"a": ["{{+30:dmy}} / {{m2d12:dmslash}} {{+1:iso}}"]}, today)
    assert filled == {"a": ["3 Nov 2026 / 12/12 2026-10-05"]}
    with pytest.raises(evals.EvalError):
        evals.fill_dates("{{+3:weird}}", today)


def test_live_cases_drop_their_script_and_keep_model_neutral_expectations():
    live = [case.for_live() for case in CASES if case.live]
    assert len(live) >= 25
    assert all(not case.script and case.expect for case in live)
    by_id = {case.id: case for case in live}
    assert set(by_id["extraction_genoa_by_name"].expect) == {"calls"}
    assert by_id["injection_in_place_name"].expect["tools_exclude"] == [
        "create_enquiry",
        "draft_quote",
    ]


def test_the_report_gives_rates_steps_tokens_and_failures(tmp_path):
    report = Report(
        "live",
        "gemini-test",
        [
            CaseResult("g1", "grounding", True, [], turns=3, tokens=900),
            CaseResult("g2", "grounding", False, ["guard missed ['₹1,111']"], turns=2, tokens=300),
            CaseResult("e1", "extraction", True, [], turns=4, tokens=1200),
        ],
        seconds=2.5,
    )
    assert report.rate("grounding") == 0.5 and report.misses() == ["grounding 50% < 100%"]
    assert not report.passed
    path = evals.write_report(report, tmp_path, date(2026, 10, 4))
    assert path.name == "agent-evals-2026-10-04.md"
    written = path.read_text(encoding="utf-8")
    assert "| grounding | 1/2 | 50% | 100% | NO | 2.5 | 600 |" in written
    assert "| extraction | 1/1 | 100% | 90% | yes | 4.0 | 1200 |" in written
    assert "`g2` (grounding): guard missed" in written
    assert "FAILED g2" in report.text()


def test_live_evals_without_a_key_say_so_and_write_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(evals, "_prepare_environment", lambda: None)
    assert evals.main(["--live", "--report-dir", str(tmp_path)]) == 2
    assert "TM_GOOGLE_API_KEY" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("url", "name"),
    [
        ("postgresql+asyncpg://app:pw@localhost:5433/travelmind_test", "travelmind_test"),
        ("postgresql+asyncpg://app:pw@db/travelmind_test?ssl=require", "travelmind_test"),
        # a query value with slashes must not be read as the database's name
        ("postgresql+asyncpg://app:pw@db/travelmind?sslrootcert=/certs/ca_test", "travelmind"),
        ("postgresql+asyncpg://app:pw@db", ""),
    ],
)
def test_the_database_name_is_read_from_the_url(url, name):
    assert evals._database_name(url) == name


def _settings_on(database: str) -> evals.Settings:
    url = f"postgresql+asyncpg://app:pw@localhost:5433/{database}"
    return evals.Settings(  # type: ignore[call-arg]
        _env_file=None, database_url=url, migration_database_url=url
    )


async def test_every_entry_point_refuses_a_database_not_named_test(monkeypatch):
    """Loading the eval airports replaces the reference airports: never on a dev database."""
    dev = _settings_on("travelmind")
    monkeypatch.setattr(evals, "get_settings", lambda: dev)
    with pytest.raises(evals.EvalError, match="_test"):
        async with evals.Runner(dev).ready():
            pass
    with pytest.raises(evals.EvalError, match="_test"):
        await evals.run_suite(CASES[:1], settings=dev)
    monkeypatch.setattr(evals, "_prepare_environment", lambda: None)
    assert evals.main([]) == 2


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ({"id": "a", "category": "safety", "prompt": "Hi"}, "no expectations"),
        ({"id": "b", "category": "safety", "prompt": "Hi", "expect": {}}, "no expectations"),
        (
            {"id": "c", "category": "safety", "prompt": "Hi", "live": True,
             "expect": {"status": "done"}},
            "no live expectations",
        ),
    ],
)  # fmt: skip
def test_a_case_that_checks_nothing_is_refused(tmp_path, case, message):
    path = tmp_path / "cases.yaml"
    path.write_text(json.dumps({"cases": [case]}), encoding="utf-8")
    with pytest.raises(evals.EvalError, match=message):
        evals.load_cases(path)


def test_a_live_report_says_what_it_did_not_run():
    report = Report("live", "gemini-test", [CaseResult("e1", "extraction", True, [], turns=2)])
    written = report.markdown(date(2026, 10, 4))
    assert "| grounding | 0/0 | - | 100% | not run | - | - |" in written
    assert "| limits | 0/0 | - | 90% | not run | - | - |" in written
    assert "grounding gate (100%) is not enforced in live mode" in written
    assert "Not run live: clarification, tool_choice, grounding" in report.text()
    assert report.passed  # a category not run is reported, not counted as a miss
    offline = Report("fake", "demo", [CaseResult("e1", "extraction", True, [])])
    assert "not run" not in offline.markdown(date(2026, 10, 4))


@pytest.fixture
def broken_guard(monkeypatch):
    """A grounding guard that lets everything through."""
    monkeypatch.setattr(loop, "find_violations", lambda *args, **kwargs: [])


async def test_a_broken_guard_fails_the_grounding_evals(broken_guard):
    report = await evals.run_suite([case for case in CASES if case.category == "grounding"])
    assert report.rate("grounding") is not None and report.rate("grounding") < 0.5
    assert not report.passed and report.misses()[0].startswith("grounding")


def _to_job_summary(report: Report) -> None:
    """In CI, the report on the job's summary page."""
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as page:
            page.write(report.markdown(evals.agency_today()))


async def test_the_suite_meets_its_thresholds():
    report = await evals.run_suite(CASES)
    print(report.text())
    _to_job_summary(report)
    assert report.passed, report.text()
    assert report.rate("grounding") == 1.0 and report.rate("injection") == 1.0
    assert report.seconds < 120, report.summary()
