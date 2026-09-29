from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints

# ISO 4217 currencies whose minor unit isn't 1/100.
_EXPONENTS = {
    "JPY": 0,
    "KRW": 0,
    "VND": 0,
    "IDR": 0,
    "CLP": 0,
    "ISK": 0,
    "KWD": 3,
    "BHD": 3,
    "OMR": 3,
    "JOD": 3,
    "TND": 3,
}


def normalise_code(value: object) -> object:
    """Strip and upper-case a code before its pattern check (StringConstraints checks raw input)."""
    return value.strip().upper() if isinstance(value, str) else value


CurrencyCode = Annotated[
    str, BeforeValidator(normalise_code), StringConstraints(pattern=r"^[A-Z]{3}$")
]


def exponent(currency: str) -> int:
    return _EXPONENTS.get(currency.upper(), 2)


class Money(BaseModel):
    """Exact money: integer minor units (paise, cents) plus an ISO 4217 code. Never floats."""

    model_config = ConfigDict(frozen=True)

    amount_minor: int
    currency: CurrencyCode

    @classmethod
    def from_decimal(cls, amount: Decimal | str | int | float, currency: str) -> "Money":
        code = currency.strip().upper()
        value = Decimal(str(amount))
        if not value.is_finite():
            raise ValueError("Amount must be a finite number.")
        scaled = value * (Decimal(10) ** exponent(code))
        return cls(
            amount_minor=int(scaled.quantize(Decimal(1), rounding=ROUND_HALF_UP)), currency=code
        )

    def to_decimal(self) -> Decimal:
        return Decimal(self.amount_minor) / (Decimal(10) ** exponent(self.currency))
