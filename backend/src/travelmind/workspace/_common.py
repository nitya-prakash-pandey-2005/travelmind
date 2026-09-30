"""Field types, errors and query helpers shared by the workspace routers (clients, enquiries)."""

from typing import Annotated

from fastapi import HTTPException, status
from pydantic import BeforeValidator, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.reference.service import get_airport_index


def strip_upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


def strip_lower(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def blank_to_none(value: object) -> object:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


# Postgres rejects NUL, so free text never carries it; single-line fields refuse all control chars.
SINGLE_LINE = r"^[^\x00-\x1f\x7f]*$"
NO_NUL = r"^[^\x00]*$"

AirportCode = Annotated[str, BeforeValidator(strip_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
OptionalAirport = Annotated[AirportCode | None, BeforeValidator(blank_to_none)]
Notes = Annotated[
    Annotated[str, StringConstraints(max_length=2000, pattern=NO_NUL)] | None,
    BeforeValidator(blank_to_none),
]


class WorkspaceError(Exception):
    """A request the workspace services refuse, with the plain-language message to show."""

    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class UnknownAirport(WorkspaceError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT

    def __init__(self, code: str) -> None:
        super().__init__(f"Unknown airport code {code}.")


def http_error(exc: WorkspaceError) -> HTTPException:
    return HTTPException(exc.status_code, exc.message)


def escape_like(value: str) -> str:
    """Escape LIKE wildcards; use with `escape="\\\\"`."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def check_airport(db: AsyncSession, code: str | None) -> None:
    if code is not None and (await get_airport_index(db)).get(code) is None:
        raise UnknownAirport(code)
