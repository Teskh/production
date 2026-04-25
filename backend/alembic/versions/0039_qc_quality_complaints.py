"""Add QC quality complaints.

Revision ID: 0039_qc_quality_complaints
Revises: 0038_admin_dashboard_permissions
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0039_qc_quality_complaints"
down_revision = "0038_admin_dashboard_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    qccomplaintstatus = postgresql.ENUM(
        "Open",
        "ClosureProposed",
        "Closed",
        name="qccomplaintstatus",
    )
    qccomplaintstatus_col = postgresql.ENUM(
        "Open",
        "ClosureProposed",
        "Closed",
        name="qccomplaintstatus",
        create_type=False,
    )
    qccomplaintactortype = postgresql.ENUM("qc", "supervisor", "system", name="qccomplaintactortype")
    qccomplaintactortype_col = postgresql.ENUM(
        "qc",
        "supervisor",
        "system",
        name="qccomplaintactortype",
        create_type=False,
    )
    qccomplainteventtype = postgresql.ENUM(
        "created",
        "comment",
        "media_added",
        "closure_proposed",
        "closure_accepted",
        "closure_rejected",
        name="qccomplainteventtype",
    )
    qccomplainteventtype_col = postgresql.ENUM(
        "created",
        "comment",
        "media_added",
        "closure_proposed",
        "closure_accepted",
        "closure_rejected",
        name="qccomplainteventtype",
        create_type=False,
    )
    qccomplaintmediarole = postgresql.ENUM(
        "initial",
        "comment",
        "closure_proposal",
        "qc_rejection",
        name="qccomplaintmediarole",
    )
    qccomplaintmediarole_col = postgresql.ENUM(
        "initial",
        "comment",
        "closure_proposal",
        "qc_rejection",
        name="qccomplaintmediarole",
        create_type=False,
    )

    qccomplaintstatus.create(bind, checkfirst=True)
    qccomplaintactortype.create(bind, checkfirst=True)
    qccomplainteventtype.create(bind, checkfirst=True)
    qccomplaintmediarole.create(bind, checkfirst=True)

    if "qc_quality_complaints" not in table_names:
        op.create_table(
            "qc_quality_complaints",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("work_unit_id", sa.Integer(), nullable=False),
            sa.Column("panel_unit_id", sa.Integer(), nullable=True),
            sa.Column("station_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column(
                "severity_level",
                postgresql.ENUM(
                    "baja",
                    "media",
                    "critica",
                    name="qcseveritylevel",
                    create_type=False,
                ),
                nullable=False,
            ),
            sa.Column("status", qccomplaintstatus_col, nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("closure_proposed_at", sa.DateTime(), nullable=True),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["work_unit_id"], ["work_units.id"]),
            sa.ForeignKeyConstraint(["panel_unit_id"], ["panel_units.id"]),
            sa.ForeignKeyConstraint(["station_id"], ["stations.id"]),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["admin_users.id"]),
        )
        op.create_index("ix_qc_quality_complaints_work_unit_id", "qc_quality_complaints", ["work_unit_id"])
        op.create_index("ix_qc_quality_complaints_status", "qc_quality_complaints", ["status"])

    if "qc_quality_complaint_supervisors" not in table_names:
        op.create_table(
            "qc_quality_complaint_supervisors",
            sa.Column("complaint_id", sa.Integer(), nullable=False),
            sa.Column("supervisor_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["complaint_id"], ["qc_quality_complaints.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["supervisor_id"], ["worker_supervisors.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("complaint_id", "supervisor_id"),
        )
        op.create_index(
            "ix_qc_quality_complaint_supervisors_supervisor_id",
            "qc_quality_complaint_supervisors",
            ["supervisor_id"],
        )

    if "qc_quality_complaint_events" not in table_names:
        op.create_table(
            "qc_quality_complaint_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("complaint_id", sa.Integer(), nullable=False),
            sa.Column("actor_type", qccomplaintactortype_col, nullable=False),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("actor_supervisor_id", sa.Integer(), nullable=True),
            sa.Column("event_type", qccomplainteventtype_col, nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["complaint_id"], ["qc_quality_complaints.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["actor_user_id"], ["admin_users.id"]),
            sa.ForeignKeyConstraint(["actor_supervisor_id"], ["worker_supervisors.id"]),
        )
        op.create_index("ix_qc_quality_complaint_events_complaint_id", "qc_quality_complaint_events", ["complaint_id"])

    if "qc_quality_complaint_media" not in table_names:
        op.create_table(
            "qc_quality_complaint_media",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("complaint_id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=True),
            sa.Column("media_asset_id", sa.Integer(), nullable=False),
            sa.Column("role", qccomplaintmediarole_col, nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["complaint_id"], ["qc_quality_complaints.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["event_id"], ["qc_quality_complaint_events.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["media_asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_qc_quality_complaint_media_complaint_id", "qc_quality_complaint_media", ["complaint_id"])
        op.create_index("ix_qc_quality_complaint_media_event_id", "qc_quality_complaint_media", ["event_id"])
        op.create_index("ix_qc_quality_complaint_media_media_asset_id", "qc_quality_complaint_media", ["media_asset_id"])

    if "qc_quality_complaint_notifications" not in table_names:
        op.create_table(
            "qc_quality_complaint_notifications",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("complaint_id", sa.Integer(), nullable=False),
            sa.Column("supervisor_id", sa.Integer(), nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=True),
            sa.Column(
                "status",
                postgresql.ENUM(
                    "Active",
                    "Dismissed",
                    name="qcnotificationstatus",
                    create_type=False,
                ),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("seen_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["complaint_id"], ["qc_quality_complaints.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["supervisor_id"], ["worker_supervisors.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["event_id"], ["qc_quality_complaint_events.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_qc_quality_complaint_notifications_complaint_id", "qc_quality_complaint_notifications", ["complaint_id"])
        op.create_index("ix_qc_quality_complaint_notifications_supervisor_id", "qc_quality_complaint_notifications", ["supervisor_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "qc_quality_complaint_notifications" in table_names:
        op.drop_index("ix_qc_quality_complaint_notifications_supervisor_id", table_name="qc_quality_complaint_notifications")
        op.drop_index("ix_qc_quality_complaint_notifications_complaint_id", table_name="qc_quality_complaint_notifications")
        op.drop_table("qc_quality_complaint_notifications")
    if "qc_quality_complaint_media" in table_names:
        op.drop_index("ix_qc_quality_complaint_media_media_asset_id", table_name="qc_quality_complaint_media")
        op.drop_index("ix_qc_quality_complaint_media_event_id", table_name="qc_quality_complaint_media")
        op.drop_index("ix_qc_quality_complaint_media_complaint_id", table_name="qc_quality_complaint_media")
        op.drop_table("qc_quality_complaint_media")
    if "qc_quality_complaint_events" in table_names:
        op.drop_index("ix_qc_quality_complaint_events_complaint_id", table_name="qc_quality_complaint_events")
        op.drop_table("qc_quality_complaint_events")
    if "qc_quality_complaint_supervisors" in table_names:
        op.drop_index("ix_qc_quality_complaint_supervisors_supervisor_id", table_name="qc_quality_complaint_supervisors")
        op.drop_table("qc_quality_complaint_supervisors")
    if "qc_quality_complaints" in table_names:
        op.drop_index("ix_qc_quality_complaints_status", table_name="qc_quality_complaints")
        op.drop_index("ix_qc_quality_complaints_work_unit_id", table_name="qc_quality_complaints")
        op.drop_table("qc_quality_complaints")

    for enum_name in (
        "qccomplaintmediarole",
        "qccomplainteventtype",
        "qccomplaintactortype",
        "qccomplaintstatus",
    ):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)
