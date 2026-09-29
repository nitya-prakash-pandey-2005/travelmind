from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, EmailStr, StringConstraints


def _normalize_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


NormalizedEmail = Annotated[EmailStr, BeforeValidator(_normalize_email)]
# Control characters (notably NUL, which Postgres rejects) are never valid in a name.
_NO_CONTROL_CHARS = r"^[^\x00-\x1f\x7f]+$"
PersonName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=200, pattern=_NO_CONTROL_CHARS
    ),
]
AgencyName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=2, max_length=200, pattern=_NO_CONTROL_CHARS
    ),
]
NewPassword = Annotated[str, StringConstraints(min_length=10, max_length=256)]


class SignupRequest(BaseModel):
    agency_name: AgencyName
    full_name: PersonName
    email: NormalizedEmail
    password: NewPassword


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: Annotated[str, StringConstraints(max_length=256)]


class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str


class AgencyOut(BaseModel):
    id: UUID
    name: str


class MeResponse(BaseModel):
    user: UserOut
    agency: AgencyOut


InvitableRole = Literal["admin", "agent"]


class InvitationCreate(BaseModel):
    email: NormalizedEmail
    role: InvitableRole


class InvitationOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime
    expires_at: datetime


class InvitationCreated(InvitationOut):
    token: str


class InvitationAccept(BaseModel):
    token: Annotated[str, StringConstraints(min_length=10, max_length=200)]
    full_name: PersonName
    password: NewPassword


class TeamMember(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
