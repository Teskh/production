from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import StationRole


def _enum_values(enum_cls) -> list[str]:
    return [member.value for member in enum_cls]


class ShiftEstimateWorkerPresence(Base):
    __tablename__ = "shift_estimate_worker_presence"
    __table_args__ = (
        UniqueConstraint(
            "date",
            "group_key",
            "worker_id",
            "algorithm_version",
            name="uq_shift_estimate_worker_presence_day_group_worker_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    group_key: Mapped[str] = mapped_column(String(64), index=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), index=True)
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
    is_assigned: Mapped[bool] = mapped_column(Boolean, default=True)
    is_present: Mapped[bool] = mapped_column(Boolean, default=False)
    first_entry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_exit: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attendance_status: Mapped[str] = mapped_column(String(20), default="absent")
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    algorithm_version: Mapped[int] = mapped_column(Integer, default=1)
