"""Agency profile: country, currency, timezone and brand colour (GET/PATCH /api/v1/agency)."""

from datetime import datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, StringConstraints

from travelmind.audit.service import record_event
from travelmind.db import DbSession
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser, CurrentUser, require_role
from travelmind.identity.schemas import AgencyName, CountryCode
from travelmind.readcache import InvalidatesAgencyCache
from travelmind.workspace.activity import record_activity
from travelmind.workspace.regions import default_currency_for, default_timezone_for

__all__ = [
    "AgencyProfile",
    "AgencyUpdate",
    "agency_router",
    "default_currency_for",
    "default_timezone_for",
]


def _upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


def _lower(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def _known_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone.") from None
    return value


CurrencyCode = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
BrandColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$"), AfterValidator(_lower)]
Timezone = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=64), AfterValidator(_known_timezone)
]


class AgencyProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    country_code: str
    currency: str
    timezone: str
    brand_color: str
    is_demo: bool
    demo_expires_at: datetime | None


class AgencyUpdate(BaseModel):
    name: AgencyName | None = None
    country_code: CountryCode | None = None
    currency: CurrencyCode | None = None
    timezone: Timezone | None = None
    brand_color: BrandColor | None = None


agency_router = APIRouter(
    prefix="/api/v1/agency", tags=["agency"], dependencies=[InvalidatesAgencyCache]
)
ManagerUser = Annotated[CurrentUser, Depends(require_role("owner", "admin"))]


@agency_router.get("")
async def get_agency_route(current: AuthedUser, db: DbSession) -> AgencyProfile:
    return AgencyProfile.model_validate(await identity_service.get_agency(db, current.agency_id))


@agency_router.patch("")
async def update_agency_route(
    body: AgencyUpdate, current: ManagerUser, db: DbSession
) -> AgencyProfile:
    try:
        agency, before, after = await identity_service.update_agency_profile(
            db, current.agency_id, body.model_dump(exclude_none=True)
        )
    except identity_service.DemoWorkspaceLocked:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, identity_service.DEMO_LOCKED_MESSAGE
        ) from None
    if after:
        await record_event(
            db,
            agency_id=current.agency_id,
            actor_user_id=current.id,
            action="agency.updated",
            entity_type="agency",
            entity_id=str(current.agency_id),
            before=before,
            after=after,
        )
        await record_activity(
            db,
            agency_id=current.agency_id,
            kind="agency.updated",
            summary="Updated the agency profile",
            actor_user_id=current.id,
            entity_type="agency",
            entity_id=current.agency_id,
            data={"fields": sorted(after)},
        )
        await db.commit()
    return AgencyProfile.model_validate(agency)
