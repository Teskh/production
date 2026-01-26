from datetime import datetime, date

from sqlalchemy import Date, DateTime, Enum, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import StationRole


def _enum_values(enum_cls) -> list[str]:
    return [member.value for member in enum_cls]


class ShiftEstimate(Base):
    __tablename__ = "shift_estimates"
    __table_args__ = (
        UniqueConstraint(
            "date",
            "group_key",
            "algorithm_version",
            name="uq_shift_estimates_day_group_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    group_key: Mapped[str] = mapped_column(String(64), index=True)
    station_role: Mapped[StationRole] = mapped_column(
        Enum(
            StationRole,
            values_callable=_enum_values,
            name="stationrole",
        ),
        nullable=False,
    )
    station_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sequence_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_count: Mapped[int] = mapped_column(Integer, default=0)
    present_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    estimated_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_exit: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    shift_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    algorithm_version: Mapped[int] = mapped_column(Integer, default=1)
