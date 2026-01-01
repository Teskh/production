from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import RestrictionType


class WorkerSupervisor(Base):
    __tablename__ = "worker_supervisors"

    id: Mapped[int] = mapped_column(primary_key=True)
    geovictoria_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    geovictoria_identifier: Mapped[str | None] = mapped_column(
        String(32), nullable=True, unique=True
    )
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    pin: Mapped[str | None] = mapped_column(String(10), nullable=True)


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(primary_key=True)
    geovictoria_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    geovictoria_identifier: Mapped[str | None] = mapped_column(
        String(32), nullable=True, unique=True
    )
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    pin: Mapped[str | None] = mapped_column(String(10), nullable=True)
    login_required: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    assigned_station_ids: Mapped[list[int] | None] = mapped_column(
        JSONB, nullable=True
    )
    supervisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("worker_supervisors.id"), nullable=True
    )


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)


class WorkerSkill(Base):
    __tablename__ = "worker_skills"

    worker_id: Mapped[int] = mapped_column(
        ForeignKey("workers.id"), primary_key=True
    )
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id"), primary_key=True)


class TaskSkillRequirement(Base):
    __tablename__ = "task_skill_requirements"

    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), primary_key=True
    )
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id"), primary_key=True)


class TaskWorkerRestriction(Base):
    __tablename__ = "task_worker_restrictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id"), index=True
    )
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), index=True)
    restriction_type: Mapped[RestrictionType] = mapped_column(Enum(RestrictionType))


class WorkerSession(Base):
    __tablename__ = "worker_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True
    )
