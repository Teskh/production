from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GeoVictoriaAttendanceCache(Base):
    __tablename__ = "geovictoria_attendance_cache"
    __table_args__ = (
        UniqueConstraint(
            "normalized_identifier",
            "attendance_date",
            name="uq_geovictoria_attendance_cache_identifier_day",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    normalized_identifier: Mapped[str] = mapped_column(String(32), index=True)
    attendance_date: Mapped[date] = mapped_column(Date, index=True)
    is_present: Mapped[bool] = mapped_column(Boolean, default=False)
    first_entry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_exit: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_identifier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    geovictoria_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
