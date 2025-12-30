from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import RestrictionType


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    pin: Mapped[str | None] = mapped_column(String(10), nullable=True)
    login_required: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    assigned_station_ids: Mapped[list[str] | None] = mapped_column(
        JSONB, nullable=True
    )
    supervisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
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
