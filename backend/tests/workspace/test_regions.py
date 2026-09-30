import pytest

from travelmind.workspace.agency import default_currency_for, default_timezone_for


@pytest.mark.parametrize(
    ("country", "currency", "timezone"),
    [
        ("IN", "INR", "Asia/Kolkata"),
        ("ae", "AED", "Asia/Dubai"),
        ("GB", "GBP", "Europe/London"),
        ("US", "USD", "America/New_York"),
        ("SG", "SGD", "Asia/Singapore"),
        ("FR", "USD", "UTC"),
    ],
)
def test_country_defaults(country, currency, timezone):
    assert default_currency_for(country) == currency
    assert default_timezone_for(country) == timezone
