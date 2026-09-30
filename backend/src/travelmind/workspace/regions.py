"""Country-derived agency defaults (currency, timezone).

Kept free of identity imports so identity's signup can use it without an import cycle.
"""

from travelmind.offers.fx import display_currency_for

_TIMEZONES = {
    "IN": "Asia/Kolkata",
    "AE": "Asia/Dubai",
    "GB": "Europe/London",
    "US": "America/New_York",
    "SG": "Asia/Singapore",
}
# The agency's home currency. Search display currency (display_currency_for) only knows INR/USD,
# so the launch markets are listed here and everything else falls back to it.
_CURRENCIES = {"IN": "INR", "AE": "AED", "GB": "GBP", "US": "USD", "SG": "SGD"}


def default_timezone_for(country_code: str) -> str:
    return _TIMEZONES.get(country_code.strip().upper(), "UTC")


def default_currency_for(country_code: str) -> str:
    code = country_code.strip().upper()
    return _CURRENCIES.get(code) or display_currency_for(code)
