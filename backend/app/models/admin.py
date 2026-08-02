from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    pin: Mapped[str] = mapped_column(String(32))
    role: Mapped[str] = mapped_column(String(50))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_user_id: Mapped[int] = mapped_column(
        ForeignKey("admin_users.id"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CompanyAccessSession(Base):
    __tablename__ = "company_access_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AdminDashboardPermission(Base):
    __tablename__ = "admin_dashboard_permissions"
    __table_args__ = (
        UniqueConstraint("dashboard_id", "role", name="uq_admin_dashboard_permissions_dashboard_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dashboard_id: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(50), index=True)


class AdminPagePermission(Base):
    __tablename__ = "admin_page_permissions"
    __table_args__ = (
        UniqueConstraint("page_id", "role", name="uq_admin_page_permissions_page_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(50), index=True)
    can_view: Mapped[bool] = mapped_column(Boolean, default=True)
    can_edit: Mapped[bool] = mapped_column(Boolean, default=True)


class PauseReason(Base):
    __tablename__ = "pause_reasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    applicable_station_ids: Mapped[list[int] | None] = mapped_column(
        JSONB, nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CommentTemplate(Base):
    __tablename__ = "comment_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(String(500))
    applicable_station_ids: Mapped[list[int] | None] = mapped_column(
        JSONB, nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
