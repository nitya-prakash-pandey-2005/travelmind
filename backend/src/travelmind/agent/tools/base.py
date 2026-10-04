"""The tool contract, argument validation, and the helpers every tool shapes its result with.

A tool validates its arguments with a Pydantic model (unknown fields refused), runs, and returns
trimmed JSON-safe data. A failure the model can act on is a `ToolError` (code + a plain message
that never carries supplier text); the registry turns it into `{"error": {...}}` data.

Supplier and place text (names, addresses, descriptions) is untrusted: `clean_text` drops
control and format characters (bidi overrides, zero-width), folds whitespace and truncates it,
and it only ever travels in a tool result's data, never in an instruction or an error message.

Every value the model may repeat is given in the forms it may write it: money as minor units, a
currency code and a formatted string (`format_money`, the app's style: "₹2,16,804",
"$1,234.56"), dates as ISO and as displayed ("3 Dec 2026"), flight numbers as "AI 101".
"""

import unicodedata
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, ValidationError

from travelmind.agent.context import RunContext
from travelmind.agent.provider import ToolSpec
from travelmind.offers.money import Money, exponent

# Control (Cc), format (Cf: bidi overrides, zero-width), private-use, surrogate and
# line/paragraph separator characters never reach the model from a supplier.
_DROPPED = frozenset({"Cc", "Cf", "Co", "Cs", "Zl", "Zp"})
_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}
MAX_ERROR_MESSAGE = 300


class ToolError(Exception):
    """A failure the model can act on. `message` is ours, safe to show and to send to the
    model; codes: invalid_arguments, unknown_tool, unknown_id, not_found, not_allowed,
    rate_limited, unavailable, failed."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:MAX_ERROR_MESSAGE]

    def as_data(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message}}


class Tool(Protocol):
    spec: ToolSpec
    roles: frozenset[str]
    confirm: bool  # needs the user's confirmation before running (write tools)
    ends_turn: bool  # the run waits for the user after it (ask_user)

    async def run(self, ctx: RunContext, args: dict[str, Any]) -> dict[str, Any]: ...


class Args(BaseModel):
    """Base for tool arguments: unknown fields are refused, so the model can't pass a price."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def validation_message(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors(include_url=False, include_input=False, include_context=False):
        where = ".".join(str(p) for p in error["loc"])
        message = error["msg"].removeprefix("Value error, ")
        parts.append(f"{where}: {message}" if where else message)
    return "; ".join(parts[:5])


def validate[M: BaseModel](model: type[M], data: object) -> M:
    """`model` from `data`, or ToolError("invalid_arguments") with Pydantic's messages."""
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise ToolError("invalid_arguments", validation_message(exc)) from None


def _inline(node: Any, defs: dict[str, Any]) -> Any:
    """A schema node with `$ref`s replaced by their definitions and `title`s dropped. The
    names in a `properties` map are field names, kept whatever they are (a field may be called
    "title")."""
    if isinstance(node, list):
        return [_inline(item, defs) for item in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        target = _inline(defs[ref.removeprefix("#/$defs/")], defs)
        return target | _inline({k: v for k, v in node.items() if k != "$ref"}, defs)
    inlined: dict[str, Any] = {}
    for key, value in node.items():
        if key in ("title", "$defs"):
            continue
        if key == "properties" and isinstance(value, dict):
            inlined[key] = {name: _inline(field, defs) for name, field in value.items()}
        else:
            inlined[key] = _inline(value, defs)
    return inlined


def json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON Schema with references inlined and titles dropped: plain enough for any
    provider's function declarations."""
    schema = model.model_json_schema()
    inlined: dict[str, Any] = _inline(schema, schema.get("$defs", {}))
    inlined.setdefault("properties", {})
    return inlined


class TypedTool[A: BaseModel]:
    """A tool from a Pydantic argument model and an async handler."""

    def __init__(
        self,
        name: str,
        description: str,
        args: type[A],
        handler: Callable[[RunContext, A], Awaitable[dict[str, Any]]],
        *,
        roles: frozenset[str],
        confirm: bool = False,
        ends_turn: bool = False,
    ) -> None:
        self.spec = ToolSpec(name=name, description=description, parameters=json_schema(args))
        self.roles = roles
        self.confirm = confirm
        self.ends_turn = ends_turn
        self._args = args
        self._handler = handler

    async def run(self, ctx: RunContext, args: dict[str, Any]) -> dict[str, Any]:
        return await self._handler(ctx, validate(self._args, args))

    def __repr__(self) -> str:
        return f"<tool {self.spec.name}>"


# --- result shaping ------------------------------------------------------------------------


def clean_text(value: object, limit: int = 120) -> str | None:
    """Untrusted text made safe to show the model: no control or format characters, whitespace
    folded, at most `limit` characters ("…" marks a cut). None for non-text or blank."""
    if not isinstance(value, str):
        return None
    text = unicodedata.normalize("NFKC", value[: limit * 4])
    kept = []
    for char in text:
        category = unicodedata.category(char)
        if category in _DROPPED:
            if category == "Cc" or category in ("Zl", "Zp"):
                kept.append(" ")
            continue
        kept.append(char)
    folded = " ".join("".join(kept).split())
    if len(folded) > limit:
        folded = folded[: limit - 1].rstrip() + "…"
    return folded or None


def _group(digits: str, indian: bool) -> str:
    if not indian or len(digits) <= 3:
        return f"{int(digits):,}"
    head, tail = digits[:-3], digits[-3:]
    pairs: list[str] = []
    while len(head) > 2:
        pairs.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([head, *pairs, tail])


def format_money(money: Money) -> str:
    """The app's money format: Indian grouping for INR, a symbol where one is common, else the
    code; minor units only when there are some ("₹2,16,804", "₹12,345.67", "AED 12,345")."""
    places = exponent(money.currency)
    whole, minor = divmod(abs(money.amount_minor), 10**places)
    text = _group(str(whole), money.currency == "INR")
    if places and minor:
        text += f".{minor:0{places}d}"
    sign = "-" if money.amount_minor < 0 else ""
    symbol = _SYMBOLS.get(money.currency)
    return f"{sign}{symbol}{text}" if symbol else f"{sign}{money.currency} {text}"


def money_fields(prefix: str, money: Money | None) -> dict[str, Any]:
    """`<prefix>_minor`, `<prefix>_currency` and `<prefix>_formatted` (all None without money)."""
    return {
        f"{prefix}_minor": money.amount_minor if money else None,
        f"{prefix}_currency": money.currency if money else None,
        f"{prefix}_formatted": format_money(money) if money else None,
    }


def display_date(value: date) -> str:
    """A date as the app shows it: "3 Dec 2026"."""
    return f"{value.day} {value:%b %Y}"


def date_fields(prefix: str, value: date | None) -> dict[str, Any]:
    return {
        prefix: value.isoformat() if value else None,
        f"{prefix}_display": display_date(value) if value else None,
    }
