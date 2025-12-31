from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import TaskExceptionType, TaskScope, TaskStatus


class TaskDefinition(Base):
    __tablename__ = "task_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    scope: Mapped[TaskScope] = mapped_column(Enum(TaskScope))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    skippable: Mapped[bool] = mapped_column(Boolean, default=False)
    concurrent_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    advance_trigger: Mapped[bool] = mapped_column(Boolean, default=False)
    dependencies_json: Mapped[list[int] | None] = mapped_column(
        JSONB, nullable=True
    )


class TaskApplicability(Base):
    __tablename__ = "task_applicability"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), index=True
    )
    house_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_types.id"), nullable=True
    )
    sub_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_sub_types.id"), nullable=True
    )
    module_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    panel_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("panel_definitions.id"), nullable=True
    )
    applies: Mapped[bool] = mapped_column(Boolean, default=True)
    station_sequence_order: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TaskExpectedDuration(Base):
    __tablename__ = "task_expected_durations"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), index=True
    )
    house_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_types.id"), nullable=True
    )
    sub_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_sub_types.id"), nullable=True
    )
    module_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    panel_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("panel_definitions.id"), nullable=True
    )
    expected_minutes: Mapped[float] = mapped_column(Numeric(10, 2))


class TaskInstance(Base):
    __tablename__ = "task_instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), index=True
    )
    scope: Mapped[TaskScope] = mapped_column(Enum(TaskScope))
    work_unit_id: Mapped[int] = mapped_column(ForeignKey("work_units.id"), index=True)
    panel_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("panel_units.id"), nullable=True
    )
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus), default=TaskStatus.NOT_STARTED
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class TaskParticipation(Base):
    __tablename__ = "task_participations"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_instance_id: Mapped[int] = mapped_column(
        ForeignKey("task_instances.id"), index=True
    )
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime)
    left_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TaskPause(Base):
    __tablename__ = "task_pauses"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_instance_id: Mapped[int] = mapped_column(
        ForeignKey("task_instances.id"), index=True
    )
    reason_id: Mapped[int | None] = mapped_column(
        ForeignKey("pause_reasons.id"), nullable=True
    )
    reason_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    paused_at: Mapped[datetime] = mapped_column(DateTime)
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TaskException(Base):
    __tablename__ = "task_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), index=True
    )
    scope: Mapped[TaskScope] = mapped_column(Enum(TaskScope))
    work_unit_id: Mapped[int] = mapped_column(ForeignKey("work_units.id"), index=True)
    panel_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("panel_units.id"), nullable=True
    )
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    exception_type: Mapped[TaskExceptionType] = mapped_column(
        Enum(TaskExceptionType)
    )
    reason_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_worker_id: Mapped[int] = mapped_column(
        ForeignKey("workers.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime)
