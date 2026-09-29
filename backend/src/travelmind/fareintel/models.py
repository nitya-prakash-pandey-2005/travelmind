from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Identity, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow


class FareSnapshot(Base):
    """A fare observed in the market (global, append-only). Amounts are `currency` minor units."""

    __tablename__ = "fare_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    departure_date: Mapped[date] = mapped_column(Date)
    days_to_departure: Mapped[int]
    cabin: Mapped[str] = mapped_column(String(20))
    carrier: Mapped[str | None] = mapped_column(String(3))
    stops: Mapped[int | None] = mapped_column(SmallInteger)
    total_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    provenance: Mapped[str] = mapped_column(String(10))
    source: Mapped[str] = mapped_column(String(30))
