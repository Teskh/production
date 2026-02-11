from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PerformanceEvent(Base):
    __tablename__ = "performance_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    page_path: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    api_path: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    method: Mapped[str | None] = mapped_column(String(12), nullable=True)
    duration_ms: Mapped[float] = mapped_column(Numeric(10, 2))
    server_duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    device_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    sampled: Mapped[bool] = mapped_column(Boolean, default=True)
