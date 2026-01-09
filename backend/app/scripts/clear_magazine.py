from sqlalchemy import func, select, update

from app.db.session import SessionLocal
from app.models.enums import WorkUnitStatus
from app.models.work import WorkUnit


def main() -> None:
    with SessionLocal() as session:
        matched = session.execute(
            select(func.count())
            .select_from(WorkUnit)
            .where(WorkUnit.status == WorkUnitStatus.MAGAZINE)
        ).scalar_one()

        result = session.execute(
            update(WorkUnit)
            .where(WorkUnit.status == WorkUnitStatus.MAGAZINE)
            .values(status=WorkUnitStatus.COMPLETED)
        )
        session.commit()

        updated = result.rowcount if result.rowcount is not None else matched
        print(f"Updated {updated} work_units (matched {matched}).")


if __name__ == "__main__":
    main()
