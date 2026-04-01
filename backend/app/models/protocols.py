from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SafetyProtocol(Base):
    __tablename__ = "safety_protocols"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    applicability_links: Mapped[list["SafetyProtocolApplicability"]] = relationship(
        "SafetyProtocolApplicability",
        back_populates="protocol",
        cascade="all, delete-orphan",
    )
    versions: Mapped[list["SafetyProtocolVersion"]] = relationship(
        "SafetyProtocolVersion",
        back_populates="protocol",
        cascade="all, delete-orphan",
        order_by="SafetyProtocolVersion.version_number",
    )
    signatures: Mapped[list["SafetyProtocolSignature"]] = relationship(
        "SafetyProtocolSignature",
        back_populates="protocol",
        cascade="all, delete-orphan",
    )


class SafetyProtocolApplicability(Base):
    __tablename__ = "safety_protocol_applicability"
    __table_args__ = (
        UniqueConstraint(
            "protocol_id",
            "supervisor_id",
            name="uq_safety_protocol_applicability_protocol_supervisor",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("safety_protocols.id", ondelete="CASCADE"), index=True
    )
    supervisor_id: Mapped[int] = mapped_column(
        ForeignKey("worker_supervisors.id", ondelete="CASCADE"), index=True
    )

    protocol: Mapped["SafetyProtocol"] = relationship(
        "SafetyProtocol", back_populates="applicability_links"
    )


class SafetyProtocolVersion(Base):
    __tablename__ = "safety_protocol_versions"
    __table_args__ = (
        UniqueConstraint(
            "protocol_id",
            "version_number",
            name="uq_safety_protocol_versions_protocol_version_number",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("safety_protocols.id", ondelete="CASCADE"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    protocol: Mapped["SafetyProtocol"] = relationship(
        "SafetyProtocol", back_populates="versions"
    )
    documents: Mapped[list["SafetyProtocolDocument"]] = relationship(
        "SafetyProtocolDocument",
        back_populates="protocol_version",
        cascade="all, delete-orphan",
        order_by="SafetyProtocolDocument.original_filename",
    )
    signatures: Mapped[list["SafetyProtocolSignature"]] = relationship(
        "SafetyProtocolSignature",
        back_populates="protocol_version",
        cascade="all, delete-orphan",
    )


class SafetyProtocolDocument(Base):
    __tablename__ = "safety_protocol_documents"
    __table_args__ = (
        UniqueConstraint(
            "protocol_version_id",
            "original_filename",
            name="uq_safety_protocol_documents_version_filename",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    protocol_version_id: Mapped[int] = mapped_column(
        ForeignKey("safety_protocol_versions.id", ondelete="CASCADE"), index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(400))
    uri: Mapped[str] = mapped_column(String(400))
    mime_type: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    protocol_version: Mapped["SafetyProtocolVersion"] = relationship(
        "SafetyProtocolVersion", back_populates="documents"
    )


class SafetyProtocolSignature(Base):
    __tablename__ = "safety_protocol_signatures"
    __table_args__ = (
        UniqueConstraint(
            "protocol_version_id",
            "supervisor_id",
            name="uq_safety_protocol_signatures_version_supervisor",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    protocol_id: Mapped[int] = mapped_column(
        ForeignKey("safety_protocols.id", ondelete="CASCADE"), index=True
    )
    protocol_version_id: Mapped[int] = mapped_column(
        ForeignKey("safety_protocol_versions.id", ondelete="CASCADE"), index=True
    )
    supervisor_id: Mapped[int] = mapped_column(
        ForeignKey("worker_supervisors.id", ondelete="CASCADE"), index=True
    )
    signed_name: Mapped[str] = mapped_column(String(200))
    signed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    protocol: Mapped["SafetyProtocol"] = relationship(
        "SafetyProtocol", back_populates="signatures"
    )
    protocol_version: Mapped["SafetyProtocolVersion"] = relationship(
        "SafetyProtocolVersion", back_populates="signatures"
    )
