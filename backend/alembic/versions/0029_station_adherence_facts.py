"""Add task station adherence fact table.

Revision ID: 0029_station_adherence_facts
Revises: 0028_station_camera_feeds
Create Date: 2026-02-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision = "0029_station_adherence_facts"
down_revision = "0028_station_camera_feeds"
branch_labels = None
depends_on = None


_TABLE = "task_station_adherence_facts"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if _TABLE in table_names:
        return

    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_instance_id", sa.Integer(), sa.ForeignKey("task_instances.id"), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.Column("task_definition_id", sa.Integer(), sa.ForeignKey("task_definitions.id"), nullable=False),
        sa.Column(
            "scope",
            PGEnum("panel", "module", "aux", name="taskscope", create_type=False),
            nullable=False,
        ),
        sa.Column("work_unit_id", sa.Integer(), sa.ForeignKey("work_units.id"), nullable=False),
        sa.Column("panel_unit_id", sa.Integer(), sa.ForeignKey("panel_units.id"), nullable=True),
        sa.Column("actual_station_id", sa.Integer(), sa.ForeignKey("stations.id"), nullable=False),
        sa.Column("planned_station_sequence", sa.Integer(), nullable=True),
        sa.Column("planned_station_id", sa.Integer(), sa.ForeignKey("stations.id"), nullable=True),
        sa.Column("planned_line_type", sa.String(length=1), nullable=True),
        sa.Column("resolution_code", sa.String(length=40), nullable=False),
        sa.Column("is_deviation", sa.Boolean(), nullable=True),
        sa.Column(
            "included_in_kpi",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.UniqueConstraint(
            "task_instance_id",
            name="uq_task_station_adherence_facts_task_instance_id",
        ),
    )
    op.create_index(
        "ix_task_station_adherence_facts_captured_at",
        _TABLE,
        ["captured_at"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_completed_at",
        _TABLE,
        ["completed_at"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_task_definition_id",
        _TABLE,
        ["task_definition_id"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_scope",
        _TABLE,
        ["scope"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_work_unit_id",
        _TABLE,
        ["work_unit_id"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_panel_unit_id",
        _TABLE,
        ["panel_unit_id"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_actual_station_id",
        _TABLE,
        ["actual_station_id"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_planned_station_id",
        _TABLE,
        ["planned_station_id"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_resolution_code",
        _TABLE,
        ["resolution_code"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_is_deviation",
        _TABLE,
        ["is_deviation"],
    )
    op.create_index(
        "ix_task_station_adherence_facts_included_in_kpi",
        _TABLE,
        ["included_in_kpi"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if _TABLE not in table_names:
        return

    op.drop_index("ix_task_station_adherence_facts_included_in_kpi", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_is_deviation", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_resolution_code", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_planned_station_id", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_actual_station_id", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_panel_unit_id", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_work_unit_id", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_scope", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_task_definition_id", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_completed_at", table_name=_TABLE)
    op.drop_index("ix_task_station_adherence_facts_captured_at", table_name=_TABLE)
    op.drop_table(_TABLE)
