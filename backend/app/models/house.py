from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class HouseType(Base):
    __tablename__ = "house_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    number_of_modules: Mapped[int] = mapped_column(Integer)

    sub_types: Mapped[list["HouseSubType"]] = relationship(
        back_populates="house_type", cascade="all, delete-orphan"
    )
    panel_definitions: Mapped[list["PanelDefinition"]] = relationship(
        back_populates="house_type", cascade="all, delete-orphan"
    )


class HouseSubType(Base):
    __tablename__ = "house_sub_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    house_type_id: Mapped[int] = mapped_column(ForeignKey("house_types.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))

    house_type: Mapped["HouseType"] = relationship(back_populates="sub_types")


class PanelDefinition(Base):
    __tablename__ = "panel_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    house_type_id: Mapped[int] = mapped_column(ForeignKey("house_types.id"), index=True)
    module_sequence_number: Mapped[int] = mapped_column(Integer)
    sub_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_sub_types.id"), nullable=True
    )
    group: Mapped[str] = mapped_column(String(100))
    panel_code: Mapped[str] = mapped_column(String(100))
    panel_area: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    panel_length_m: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    panel_sequence_number: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    applicable_task_ids: Mapped[list[int] | None] = mapped_column(
        JSONB, nullable=True
    )
    task_durations_json: Mapped[list[float] | None] = mapped_column(
        JSONB, nullable=True
    )

    house_type: Mapped["HouseType"] = relationship(back_populates="panel_definitions")


class HouseParameter(Base):
    __tablename__ = "house_parameters"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)


class HouseParameterValue(Base):
    __tablename__ = "house_parameter_values"

    id: Mapped[int] = mapped_column(primary_key=True)
    house_type_id: Mapped[int] = mapped_column(
        ForeignKey("house_types.id"), index=True
    )
    parameter_id: Mapped[int] = mapped_column(
        ForeignKey("house_parameters.id"), index=True
    )
    module_sequence_number: Mapped[int] = mapped_column(Integer)
    sub_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("house_sub_types.id"), nullable=True
    )
    value: Mapped[float] = mapped_column(Numeric(12, 4))
