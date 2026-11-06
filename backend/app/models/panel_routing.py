from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import PanelUnitStatus, WorkUnitStatus


class PanelAutoRelease(Base):
    """A panel moved on automatically because its station had no work left for it.

    Holds the state before and after the move so an admin can undo it.
    """

    __tablename__ = "panel_auto_releases"

    id: Mapped[int] = mapped_column(primary_key=True)
    panel_unit_id: Mapped[int] = mapped_column(
        ForeignKey("panel_units.id", ondelete="CASCADE"), index=True
    )
    work_unit_id: Mapped[int] = mapped_column(
        ForeignKey("work_units.id", ondelete="CASCADE"), index=True
    )
    from_station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    # None when the panel was marked completed.
    to_station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True
    )
    previous_panel_status: Mapped[PanelUnitStatus] = mapped_column(
        Enum(PanelUnitStatus, native_enum=False, length=20)
    )
    new_panel_status: Mapped[PanelUnitStatus] = mapped_column(
        Enum(PanelUnitStatus, native_enum=False, length=20)
    )
    previous_work_unit_status: Mapped[WorkUnitStatus] = mapped_column(
        Enum(WorkUnitStatus, native_enum=False, length=20)
    )
    new_work_unit_status: Mapped[WorkUnitStatus] = mapped_column(
        Enum(WorkUnitStatus, native_enum=False, length=20)
    )
    # "routing_change" (configuration edit) or "script" (repair script).
    trigger: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    undone_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
