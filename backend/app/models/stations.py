from sqlalchemy import Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import StationLineType, StationRole


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    line_type: Mapped[StationLineType] = mapped_column(Enum(StationLineType))
    sequence_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    role: Mapped[StationRole] = mapped_column(Enum(StationRole))
