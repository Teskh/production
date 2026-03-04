from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.enums import StationRole
from app.models.shift_estimates import ShiftEstimate


@dataclass
class ShiftMaskResolver:
    masks_by_station_day: dict[int, dict[date, tuple[datetime, datetime] | None]]
    masks_by_sequence_day: dict[
        tuple[StationRole, int], dict[date, tuple[datetime, datetime] | None]
    ]

    @classmethod
    def load(
        cls,
        db: Session,
        *,
        station_role: StationRole,
        station_ids: set[int] | None = None,
        sequence_orders: set[int] | None = None,
        start_date: date | None,
        end_date: date | None,
        algorithm_version: int,
    ) -> "ShiftMaskResolver":
        normalized_station_ids = station_ids or set()
        normalized_sequence_orders = sequence_orders or set()
        if (
            (not normalized_station_ids and not normalized_sequence_orders)
            or start_date is None
            or end_date is None
            or start_date > end_date
        ):
            return cls(masks_by_station_day={}, masks_by_sequence_day={})

        target_filters = []
        if normalized_station_ids:
            target_filters.append(ShiftEstimate.station_id.in_(normalized_station_ids))
        if normalized_sequence_orders:
            target_filters.append(
                ShiftEstimate.sequence_order.in_(normalized_sequence_orders)
            )

        stmt = select(ShiftEstimate).where(
            ShiftEstimate.station_role == station_role,
            ShiftEstimate.date >= start_date,
            ShiftEstimate.date <= end_date,
            ShiftEstimate.algorithm_version == algorithm_version,
        )
        if len(target_filters) == 1:
            stmt = stmt.where(target_filters[0])
        else:
            stmt = stmt.where(or_(*target_filters))

        rows = list(
            db.execute(stmt).scalars()
        )

        masks_by_station_day: dict[int, dict[date, tuple[datetime, datetime] | None]] = {}
        masks_by_sequence_day: dict[
            tuple[StationRole, int], dict[date, tuple[datetime, datetime] | None]
        ] = {}
        for row in rows:
            mask: tuple[datetime, datetime] | None = None
            if (
                row.estimated_start is not None
                and row.estimated_end is not None
                and row.estimated_end > row.estimated_start
            ):
                mask = (row.estimated_start, row.estimated_end)
            if row.station_id is not None:
                masks_by_station_day.setdefault(row.station_id, {})[row.date] = mask
            if row.sequence_order is not None:
                key = (row.station_role, row.sequence_order)
                masks_by_sequence_day.setdefault(key, {})[row.date] = mask

        return cls(
            masks_by_station_day=masks_by_station_day,
            masks_by_sequence_day=masks_by_sequence_day,
        )

    def masked_minutes(
        self,
        station_id: int | None,
        start_dt: datetime | None,
        end_dt: datetime | None,
        *,
        sequence_order: int | None = None,
        station_role: StationRole | None = None,
    ) -> float | None:
        segments = self.masked_segments(
            station_id,
            start_dt,
            end_dt,
            sequence_order=sequence_order,
            station_role=station_role,
        )
        if segments is None:
            return None
        return sum(
            (segment_end - segment_start).total_seconds() / 60.0
            for segment_start, segment_end in segments
        )

    def masked_segments(
        self,
        station_id: int | None,
        start_dt: datetime | None,
        end_dt: datetime | None,
        *,
        sequence_order: int | None = None,
        station_role: StationRole | None = None,
    ) -> list[tuple[datetime, datetime]] | None:
        if start_dt is None or end_dt is None or end_dt <= start_dt:
            return None

        day_map = (
            self.masks_by_station_day.get(station_id) if station_id is not None else None
        )
        if day_map is None and sequence_order is not None and station_role is not None:
            day_map = self.masks_by_sequence_day.get((station_role, sequence_order))
        if not day_map:
            return None

        segments: list[tuple[datetime, datetime]] = []
        day_cursor = start_dt.date()
        end_day = end_dt.date()
        while day_cursor <= end_day:
            if day_cursor not in day_map:
                # Missing cache row for any covered day triggers raw fallback.
                return None
            mask = day_map[day_cursor]
            if mask is not None:
                work_start, work_end = mask
                overlap_start = max(start_dt, work_start)
                overlap_end = min(end_dt, work_end)
                if overlap_end > overlap_start:
                    segments.append((overlap_start, overlap_end))
            # Explicit row with null mask means no-shift day and contributes zero.
            day_cursor += timedelta(days=1)

        return segments
