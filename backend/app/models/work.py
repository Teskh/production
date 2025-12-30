from __future__ import annotations

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import PanelUnitStatus, WorkUnitStatus


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_name: Mapped[str] = mapped_column(String(200))
    house_type_id: Mapped[int] = mapped_column(
        ForeignKey("house_types.id"), index=True
    )
    sub_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_sub_types.id"), nullable=True
    )
    planned_sequence: Mapped[int] = mapped_column(Integer, index=True)
    planned_assembly_line: Mapped[str | None] = mapped_column(String(1), nullable=True)

    work_units: Mapped[list["WorkUnit"]] = relationship(
        back_populates="work_order", cascade="all, delete-orphan"
    )


class WorkUnit(Base):
    __tablename__ = "work_units"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    module_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[WorkUnitStatus] = mapped_column(
        Enum(WorkUnitStatus), default=WorkUnitStatus.PLANNED
    )
    current_station_id: Mapped[str | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True
    )

    work_order: Mapped["WorkOrder"] = relationship(back_populates="work_units")
    panel_units: Mapped[list["PanelUnit"]] = relationship(
        back_populates="work_unit", cascade="all, delete-orphan"
    )


class PanelUnit(Base):
    __tablename__ = "panel_units"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_unit_id: Mapped[int] = mapped_column(ForeignKey("work_units.id"), index=True)
    panel_definition_id: Mapped[int] = mapped_column(
        ForeignKey("panel_definitions.id"), index=True
    )
    status: Mapped[PanelUnitStatus] = mapped_column(
        Enum(PanelUnitStatus), default=PanelUnitStatus.PLANNED
    )
    current_station_id: Mapped[str | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True
    )

    work_unit: Mapped["WorkUnit"] = relationship(back_populates="panel_units")
