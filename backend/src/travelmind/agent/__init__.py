"""The agent engine: a provider-neutral, bounded tool-calling loop that plans trips from
TravelMind's own tools (see docs/superpowers/specs/2026-10-03-travelmind-platform-v3-design.md §4).

- `provider`: the model interface, its message types and `get_provider`.
- `gemini`: the Gemini implementation (google-genai), behind the supplier guard.
- `fake`: a scripted provider for tests and evals, and the rule-based demo planner (`planner`).
- `models`: run, step and monthly usage tables (tenant data under forced RLS).
- `budget`: the monthly token budget and the per-agency limit on concurrent runs.
- `context`: the RunContext tools run under (the run's agency, user and role) and the run
  memory of what tools returned (short ids F1/H1/P1, prices).
- `tools`: the typed tool registry, scoped by role, and `execute` (results are always data).
"""
