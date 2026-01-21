from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import (
    QCCheckKind,
    QCCheckOrigin,
    QCCheckStatus,
    QCCheckMediaType,
    QCExecutionOutcome,
    QCNotificationStatus,
    QCReworkStatus,
    QCSeverityLevel,
    QCTriggerEventType,
    TaskScope,
)


class QCCheckDefinition(Base):
    __tablename__ = "qc_check_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    guidance_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[QCCheckKind] = mapped_column(Enum(QCCheckKind))
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("qc_check_categories.id"), nullable=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class QCCheckCategory(Base):
    __tablename__ = "qc_check_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("qc_check_categories.id"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int | None] = mapped_column(Integer, nullable=True)


class QCTrigger(Base):
    __tablename__ = "qc_triggers"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_definition_id: Mapped[int] = mapped_column(
        ForeignKey("qc_check_definitions.id"), index=True
    )
    event_type: Mapped[QCTriggerEventType] = mapped_column(Enum(QCTriggerEventType))
    params_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sampling_rate: Mapped[float] = mapped_column(Float, default=1.0)
    sampling_autotune: Mapped[bool] = mapped_column(Boolean, default=False)
    sampling_step: Mapped[float] = mapped_column(Float, default=0.2)
    current_sampling_rate: Mapped[float | None] = mapped_column(Float, nullable=True)


class QCApplicability(Base):
    __tablename__ = "qc_applicability"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_definition_id: Mapped[int] = mapped_column(
        ForeignKey("qc_check_definitions.id"), index=True
    )
    house_type_links: Mapped[list["QCApplicabilityHouseType"]] = relationship(
        "QCApplicabilityHouseType",
        back_populates="applicability",
        cascade="all, delete-orphan",
    )
    sub_type_links: Mapped[list["QCApplicabilitySubType"]] = relationship(
        "QCApplicabilitySubType",
        back_populates="applicability",
        cascade="all, delete-orphan",
    )
    panel_group_links: Mapped[list["QCApplicabilityPanelGroup"]] = relationship(
        "QCApplicabilityPanelGroup",
        back_populates="applicability",
        cascade="all, delete-orphan",
    )

    @property
    def house_type_ids(self) -> list[int]:
        return [link.house_type_id for link in self.house_type_links]

    @property
    def sub_type_ids(self) -> list[int]:
        return [link.sub_type_id for link in self.sub_type_links]

    @property
    def panel_groups(self) -> list[str]:
        return [link.panel_group for link in self.panel_group_links]


class QCApplicabilityHouseType(Base):
    __tablename__ = "qc_applicability_house_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    applicability_id: Mapped[int] = mapped_column(
        ForeignKey("qc_applicability.id", ondelete="CASCADE"), index=True
    )
    house_type_id: Mapped[int] = mapped_column(
        ForeignKey("house_types.id", ondelete="CASCADE"), index=True
    )

    applicability: Mapped[QCApplicability] = relationship(
        "QCApplicability", back_populates="house_type_links"
    )


class QCApplicabilitySubType(Base):
    __tablename__ = "qc_applicability_sub_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    applicability_id: Mapped[int] = mapped_column(
        ForeignKey("qc_applicability.id", ondelete="CASCADE"), index=True
    )
    sub_type_id: Mapped[int] = mapped_column(
        ForeignKey("house_sub_types.id", ondelete="CASCADE"), index=True
    )

    applicability: Mapped[QCApplicability] = relationship(
        "QCApplicability", back_populates="sub_type_links"
    )


class QCApplicabilityPanelGroup(Base):
    __tablename__ = "qc_applicability_panel_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    applicability_id: Mapped[int] = mapped_column(
        ForeignKey("qc_applicability.id", ondelete="CASCADE"), index=True
    )
    panel_group: Mapped[str] = mapped_column(String(100))

    applicability: Mapped[QCApplicability] = relationship(
        "QCApplicability", back_populates="panel_group_links"
    )


class QCCheckInstance(Base):
    __tablename__ = "qc_check_instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("qc_check_definitions.id"), nullable=True
    )
    origin: Mapped[QCCheckOrigin] = mapped_column(Enum(QCCheckOrigin))
    ad_hoc_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ad_hoc_guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[TaskScope] = mapped_column(Enum(TaskScope))
    work_unit_id: Mapped[int] = mapped_column(ForeignKey("work_units.id"), index=True)
    panel_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("panel_units.id"), nullable=True
    )
    related_task_instance_id: Mapped[int | None] = mapped_column(
        ForeignKey("task_instances.id"), nullable=True
    )
    station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True
    )
    status: Mapped[QCCheckStatus] = mapped_column(Enum(QCCheckStatus))
    severity_level: Mapped[QCSeverityLevel | None] = mapped_column(
        Enum(
            QCSeverityLevel,
            name="qcseveritylevel",
            values_callable=lambda enum: [item.value for item in enum],
        ),
        nullable=True,
    )
    opened_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class QCExecution(Base):
    __tablename__ = "qc_executions"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_instance_id: Mapped[int] = mapped_column(
        ForeignKey("qc_check_instances.id"), index=True
    )
    outcome: Mapped[QCExecutionOutcome] = mapped_column(Enum(QCExecutionOutcome))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    measurement_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    performed_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("admin_users.id"), index=True
    )
    performed_at: Mapped[datetime] = mapped_column(DateTime)


class QCFailureModeDefinition(Base):
    __tablename__ = "qc_failure_mode_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("qc_check_definitions.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_severity_level: Mapped[QCSeverityLevel | None] = mapped_column(
        Enum(
            QCSeverityLevel,
            name="qcseveritylevel",
            values_callable=lambda enum: [item.value for item in enum],
        ),
        nullable=True,
    )
    default_rework_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class QCCheckMediaAsset(Base):
    __tablename__ = "qc_check_media_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_definition_id: Mapped[int] = mapped_column(
        ForeignKey("qc_check_definitions.id"), index=True
    )
    media_type: Mapped[QCCheckMediaType] = mapped_column(
        Enum(QCCheckMediaType, values_callable=lambda enum: [item.value for item in enum])
    )
    uri: Mapped[str] = mapped_column(String(400))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(400))
    mime_type: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    watermark_text: Mapped[str | None] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class QCEvidence(Base):
    __tablename__ = "qc_evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("qc_executions.id"), index=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        ForeignKey("media_assets.id"), index=True
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime)


class QCExecutionFailureMode(Base):
    __tablename__ = "qc_execution_failure_modes"

    id: Mapped[int] = mapped_column(primary_key=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("qc_executions.id"), index=True
    )
    failure_mode_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("qc_failure_mode_definitions.id"), nullable=True
    )
    other_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    measurement_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class QCReworkTask(Base):
    __tablename__ = "qc_rework_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_instance_id: Mapped[int] = mapped_column(
        ForeignKey("qc_check_instances.id"), index=True
    )
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[QCReworkStatus] = mapped_column(Enum(QCReworkStatus))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class QCNotification(Base):
    __tablename__ = "qc_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), index=True)
    rework_task_id: Mapped[int] = mapped_column(
        ForeignKey("qc_rework_tasks.id"), index=True
    )
    status: Mapped[QCNotificationStatus] = mapped_column(
        Enum(QCNotificationStatus)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
