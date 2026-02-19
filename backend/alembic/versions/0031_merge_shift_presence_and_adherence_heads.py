"""Merge shift presence and adherence heads.

Revision ID: 0031_merge_shift_presence_heads
Revises: 0030_adherence_completed_station, 0029_shift_worker_presence
Create Date: 2026-02-18
"""

from __future__ import annotations


revision = "0031_merge_shift_presence_heads"
down_revision = ("0030_adherence_completed_station", "0029_shift_worker_presence")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
