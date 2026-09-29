from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base


class Country(Base):
    __tablename__ = "countries"

    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    continent: Mapped[str | None] = mapped_column(String(2))


class Airport(Base):
    __tablename__ = "airports"

    iata_code: Mapped[str] = mapped_column(String(3), primary_key=True)
    ident: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(200))
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"))
    airport_type: Mapped[str] = mapped_column(String(32))
    scheduled_service: Mapped[bool]
    latitude: Mapped[float]
    longitude: Mapped[float]
    keywords: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
