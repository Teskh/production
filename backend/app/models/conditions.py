from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ConditionType(Base):
    __tablename__ = "condition_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    values: Mapped[list["ConditionValue"]] = relationship(
        back_populates="condition_type", cascade="all, delete-orphan"
    )


class ConditionValue(Base):
    __tablename__ = "condition_values"
    __table_args__ = (
        UniqueConstraint("condition_type_id", "name", name="uq_condition_value_type_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    condition_type_id: Mapped[int] = mapped_column(
        ForeignKey("condition_types.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))

    condition_type: Mapped["ConditionType"] = relationship(back_populates="values")


class WorkUnitCondition(Base):
    __tablename__ = "work_unit_conditions"
    __table_args__ = (
        UniqueConstraint(
            "work_unit_id", "condition_value_id", name="uq_work_unit_condition"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    work_unit_id: Mapped[int] = mapped_column(
        ForeignKey("work_units.id", ondelete="CASCADE"), index=True
    )
    condition_value_id: Mapped[int] = mapped_column(
        ForeignKey("condition_values.id", ondelete="CASCADE"), index=True
    )


class TaskConditionRule(Base):
    """One applicability rule for a task.

    A rule matches a work unit when its house type matches (or the rule is
    global) — then 'is' requires at least one of the rule's values to be
    assigned to the unit, while 'is_not' requires none of them to be. All
    matching rules must pass for the task to apply.
    """

    __tablename__ = "task_condition_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_definition_id: Mapped[int] = mapped_column(
        ForeignKey("task_definitions.id", ondelete="CASCADE"), index=True
    )
    condition_type_id: Mapped[int] = mapped_column(
        ForeignKey("condition_types.id", ondelete="CASCADE"), index=True
    )
    house_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_types.id", ondelete="CASCADE"), nullable=True
    )
    mode: Mapped[str] = mapped_column(String(10), default="is")

    rule_values: Mapped[list["TaskConditionRuleValue"]] = relationship(
        back_populates="rule", cascade="all, delete-orphan"
    )


class TaskConditionRuleValue(Base):
    __tablename__ = "task_condition_rule_values"
    __table_args__ = (
        UniqueConstraint("rule_id", "condition_value_id", name="uq_task_condition_rule_value"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("task_condition_rules.id", ondelete="CASCADE"), index=True
    )
    condition_value_id: Mapped[int] = mapped_column(
        ForeignKey("condition_values.id", ondelete="CASCADE"), index=True
    )

    rule: Mapped["TaskConditionRule"] = relationship(back_populates="rule_values")
