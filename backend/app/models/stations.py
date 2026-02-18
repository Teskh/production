from sqlalchemy import Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import StationLineType, StationRole


def _enum_values(enum_cls) -> list[str]:
    return [member.value for member in enum_cls]


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    line_type: Mapped[StationLineType | None] = mapped_column(
        Enum(
            StationLineType,
            values_callable=_enum_values,
            name="stationlinetype",
        ),
        nullable=True,
    )
    sequence_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    camera_feed_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[StationRole] = mapped_column(
        Enum(
            StationRole,
            values_callable=_enum_values,
            name="stationrole",
        )
    )
