from __future__ import annotations

import argparse
from dataclasses import dataclass

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.enums import StationLineType, StationRole
from app.models.stations import Station
from app.models.work import WorkUnit


@dataclass(frozen=True)
class ModuleTarget:
    work_unit_id: int
    module_label: str
    station_label: str
    line: StationLineType


STATION_LABELS = {
    "Armado": "Armado",
    "E1": "Estacion 1",
    "E2": "Estacion 2",
    "E3": "Estacion 3",
}


def _work_unit_id(module_number: int, is_md1: bool) -> int:
    base_md1 = 493  # 17 MD1
    offset = (module_number - 17) * 2
    md1_id = base_md1 + offset
    return md1_id if is_md1 else md1_id - 1


def _build_targets() -> list[ModuleTarget]:
    return [
        ModuleTarget(
            work_unit_id=_work_unit_id(17, True),
            module_label="17 MD1",
            station_label="E2",
            line=StationLineType.LINE_1,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(17, False),
            module_label="17 MD2",
            station_label="E3",
            line=StationLineType.LINE_1,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(18, True),
            module_label="18 MD1",
            station_label="E3",
            line=StationLineType.LINE_3,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(18, False),
            module_label="18 MD2",
            station_label="E3",
            line=StationLineType.LINE_2,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(19, True),
            module_label="19 MD1",
            station_label="E2",
            line=StationLineType.LINE_2,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(19, False),
            module_label="19 MD2",
            station_label="E2",
            line=StationLineType.LINE_3,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(20, True),
            module_label="20 MD1",
            station_label="E1",
            line=StationLineType.LINE_3,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(20, False),
            module_label="20 MD2",
            station_label="E1",
            line=StationLineType.LINE_1,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(21, True),
            module_label="21 MD1",
            station_label="Armado",
            line=StationLineType.LINE_1,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(21, False),
            module_label="21 MD2",
            station_label="E1",
            line=StationLineType.LINE_2,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(22, True),
            module_label="22 MD1",
            station_label="Armado",
            line=StationLineType.LINE_2,
        ),
        ModuleTarget(
            work_unit_id=_work_unit_id(22, False),
            module_label="22 MD2",
            station_label="Armado",
            line=StationLineType.LINE_3,
        ),
    ]


def _station_label(station: Station | None) -> str:
    if not station:
        return "None"
    if station.line_type is None:
        return station.name
    return f"{station.name} (L{station.line_type.value})"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Align module current_station_id and planned_assembly_line to the reference grid."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without modifying the database.",
    )
    args = parser.parse_args()

    targets = _build_targets()

    with SessionLocal() as session:
        stations = list(session.execute(select(Station)).scalars())
        station_by_key = {
            (station.name, station.line_type): station for station in stations
        }
        station_by_id = {station.id: station for station in stations}

        updated = 0
        for target in targets:
            work_unit = session.get(WorkUnit, target.work_unit_id)
            if not work_unit:
                print(
                    f"Missing work unit {target.work_unit_id} ({target.module_label}); skipping."
                )
                continue

            station_name = STATION_LABELS[target.station_label]
            station = station_by_key.get((station_name, target.line))
            if not station:
                print(
                    "Missing station for "
                    f"{target.station_label} line {target.line.value}; skipping."
                )
                continue

            before_station = station_by_id.get(work_unit.current_station_id)
            before_line = work_unit.planned_assembly_line
            target_line = target.line.value

            change_station = work_unit.current_station_id != station.id
            change_line = before_line != target_line
            if not change_station and not change_line:
                print(
                    f"WorkUnit {work_unit.id} ({target.module_label}) already aligned "
                    f"at {_station_label(before_station)} with L{before_line or '-'}."
                )
                continue

            print(
                f"WorkUnit {work_unit.id} ({target.module_label}) "
                f"{_station_label(before_station)} / L{before_line or '-'} "
                f"-> {_station_label(station)} / L{target_line}"
                + (" (dry-run)" if args.dry_run else "")
            )

            if not args.dry_run:
                work_unit.current_station_id = station.id
                work_unit.planned_assembly_line = target_line
                updated += 1

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
            print(f"Updated {updated} work units.")


if __name__ == "__main__":
    main()
