from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.stations import Station
from app.models.workers import Skill, Worker, WorkerSkill, WorkerSupervisor
from app.schemas.workers import (
    SkillAssignment,
    SkillCreate,
    SkillRead,
    SkillUpdate,
    WorkerAssignment,
    WorkerCreate,
    WorkerRead,
    WorkerSupervisorCreate,
    WorkerSupervisorRead,
    WorkerSupervisorUpdate,
    WorkerSkillRead,
    WorkerUpdate,
)

router = APIRouter()


def _normalize_geovictoria_value(value: str | None, label: str) -> str:
    if value is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} is required")
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} is required")
    return normalized


def _ensure_geovictoria_unique(
    db: Session,
    *,
    geovictoria_id: str | None,
    geovictoria_identifier: str | None,
    worker_id: int | None = None,
) -> None:
    if geovictoria_id:
        stmt = select(Worker.id).where(Worker.geovictoria_id == geovictoria_id)
        if worker_id is not None:
            stmt = stmt.where(Worker.id != worker_id)
        if db.execute(stmt).scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GeoVictoria ID is already linked to another worker",
            )
    if geovictoria_identifier:
        stmt = select(Worker.id).where(
            Worker.geovictoria_identifier == geovictoria_identifier
        )
        if worker_id is not None:
            stmt = stmt.where(Worker.id != worker_id)
        if db.execute(stmt).scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GeoVictoria identifier is already linked to another worker",
            )


def _ensure_supervisor_geovictoria_unique(
    db: Session,
    *,
    geovictoria_id: str | None,
    geovictoria_identifier: str | None,
    supervisor_id: int | None = None,
) -> None:
    if geovictoria_id:
        stmt = select(WorkerSupervisor.id).where(
            WorkerSupervisor.geovictoria_id == geovictoria_id
        )
        if supervisor_id is not None:
            stmt = stmt.where(WorkerSupervisor.id != supervisor_id)
        if db.execute(stmt).scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GeoVictoria ID is already linked to another supervisor",
            )
    if geovictoria_identifier:
        stmt = select(WorkerSupervisor.id).where(
            WorkerSupervisor.geovictoria_identifier == geovictoria_identifier
        )
        if supervisor_id is not None:
            stmt = stmt.where(WorkerSupervisor.id != supervisor_id)
        if db.execute(stmt).scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="GeoVictoria identifier is already linked to another supervisor",
            )


@router.get("/", response_model=list[WorkerRead])
def list_workers(db: Session = Depends(get_db)) -> list[Worker]:
    return list(db.execute(select(Worker).order_by(Worker.last_name, Worker.first_name)).scalars())


@router.post("/", response_model=WorkerRead, status_code=status.HTTP_201_CREATED)
def create_worker(payload: WorkerCreate, db: Session = Depends(get_db)) -> Worker:
    geovictoria_id = _normalize_geovictoria_value(payload.geovictoria_id, "GeoVictoria ID")
    geovictoria_identifier = _normalize_geovictoria_value(
        payload.geovictoria_identifier, "GeoVictoria identifier"
    )
    _ensure_geovictoria_unique(
        db,
        geovictoria_id=geovictoria_id,
        geovictoria_identifier=geovictoria_identifier,
    )
    if payload.supervisor_id is not None and not db.get(
        WorkerSupervisor, payload.supervisor_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Supervisor not found"
        )
    if payload.assigned_station_ids:
        stations = list(
            db.execute(select(Station.id).where(Station.id.in_(payload.assigned_station_ids))).all()
        )
        if len(stations) != len(set(payload.assigned_station_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more stations not found",
            )
    payload_data = payload.model_dump()
    payload_data["geovictoria_id"] = geovictoria_id
    payload_data["geovictoria_identifier"] = geovictoria_identifier
    worker = Worker(**payload_data)
    db.add(worker)
    db.commit()
    db.refresh(worker)
    return worker


@router.get("/supervisors", response_model=list[WorkerSupervisorRead])
def list_supervisors(db: Session = Depends(get_db)) -> list[WorkerSupervisor]:
    return list(
        db.execute(
            select(WorkerSupervisor).order_by(
                WorkerSupervisor.last_name, WorkerSupervisor.first_name
            )
        ).scalars()
    )


@router.post(
    "/supervisors", response_model=WorkerSupervisorRead, status_code=status.HTTP_201_CREATED
)
def create_supervisor(
    payload: WorkerSupervisorCreate, db: Session = Depends(get_db)
) -> WorkerSupervisor:
    geovictoria_id = _normalize_geovictoria_value(payload.geovictoria_id, "GeoVictoria ID")
    geovictoria_identifier = _normalize_geovictoria_value(
        payload.geovictoria_identifier, "GeoVictoria identifier"
    )
    _ensure_supervisor_geovictoria_unique(
        db,
        geovictoria_id=geovictoria_id,
        geovictoria_identifier=geovictoria_identifier,
    )
    payload_data = payload.model_dump()
    payload_data["geovictoria_id"] = geovictoria_id
    payload_data["geovictoria_identifier"] = geovictoria_identifier
    supervisor = WorkerSupervisor(**payload_data)
    db.add(supervisor)
    db.commit()
    db.refresh(supervisor)
    return supervisor


@router.get("/supervisors/{supervisor_id}", response_model=WorkerSupervisorRead)
def get_supervisor(
    supervisor_id: int, db: Session = Depends(get_db)
) -> WorkerSupervisor:
    supervisor = db.get(WorkerSupervisor, supervisor_id)
    if not supervisor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supervisor not found"
        )
    return supervisor


@router.put("/supervisors/{supervisor_id}", response_model=WorkerSupervisorRead)
def update_supervisor(
    supervisor_id: int,
    payload: WorkerSupervisorUpdate,
    db: Session = Depends(get_db),
) -> WorkerSupervisor:
    supervisor = db.get(WorkerSupervisor, supervisor_id)
    if not supervisor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supervisor not found"
        )
    payload_data = payload.model_dump(exclude_unset=True)
    if "geovictoria_id" in payload_data:
        payload_data["geovictoria_id"] = _normalize_geovictoria_value(
            payload_data.get("geovictoria_id"), "GeoVictoria ID"
        )
    if "geovictoria_identifier" in payload_data:
        payload_data["geovictoria_identifier"] = _normalize_geovictoria_value(
            payload_data.get("geovictoria_identifier"), "GeoVictoria identifier"
        )
    if "geovictoria_id" in payload_data or "geovictoria_identifier" in payload_data:
        _ensure_supervisor_geovictoria_unique(
            db,
            geovictoria_id=payload_data.get("geovictoria_id"),
            geovictoria_identifier=payload_data.get("geovictoria_identifier"),
            supervisor_id=supervisor.id,
        )
    for key, value in payload_data.items():
        setattr(supervisor, key, value)
    db.commit()
    db.refresh(supervisor)
    return supervisor


@router.delete("/supervisors/{supervisor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supervisor(supervisor_id: int, db: Session = Depends(get_db)) -> None:
    supervisor = db.get(WorkerSupervisor, supervisor_id)
    if not supervisor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Supervisor not found"
        )
    db.delete(supervisor)
    db.commit()


@router.get("/skills", response_model=list[SkillRead])
def list_skills(db: Session = Depends(get_db)) -> list[Skill]:
    return list(db.execute(select(Skill).order_by(Skill.name)).scalars())


@router.get("/skills/assignments", response_model=list[WorkerSkillRead])
def list_skill_assignments(db: Session = Depends(get_db)) -> list[WorkerSkill]:
    return list(db.execute(select(WorkerSkill)).scalars())


@router.post("/skills", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
def create_skill(payload: SkillCreate, db: Session = Depends(get_db)) -> Skill:
    skill = Skill(**payload.model_dump())
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill


@router.get("/skills/{skill_id}", response_model=SkillRead)
def get_skill(skill_id: int, db: Session = Depends(get_db)) -> Skill:
    skill = db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    return skill


@router.put("/skills/{skill_id}", response_model=SkillRead)
def update_skill(skill_id: int, payload: SkillUpdate, db: Session = Depends(get_db)) -> Skill:
    skill = db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(skill, key, value)
    db.commit()
    db.refresh(skill)
    return skill


@router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: int, db: Session = Depends(get_db)) -> None:
    skill = db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    db.delete(skill)
    db.commit()


@router.put("/skills/{skill_id}/workers", response_model=list[WorkerRead])
def set_skill_workers(
    skill_id: int, payload: WorkerAssignment, db: Session = Depends(get_db)
) -> list[Worker]:
    skill = db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    if payload.worker_ids:
        workers = list(
            db.execute(select(Worker).where(Worker.id.in_(payload.worker_ids))).scalars()
        )
        if len(workers) != len(set(payload.worker_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more workers not found",
            )
    else:
        workers = []
    db.query(WorkerSkill).filter(WorkerSkill.skill_id == skill_id).delete()
    for worker in workers:
        db.add(WorkerSkill(worker_id=worker.id, skill_id=skill_id))
    db.commit()
    return workers


@router.get("/{worker_id}", response_model=WorkerRead)
def get_worker(worker_id: int, db: Session = Depends(get_db)) -> Worker:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    return worker


@router.put("/{worker_id}", response_model=WorkerRead)
def update_worker(worker_id: int, payload: WorkerUpdate, db: Session = Depends(get_db)) -> Worker:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    payload_data = payload.model_dump(exclude_unset=True)
    if "geovictoria_id" in payload_data:
        payload_data["geovictoria_id"] = _normalize_geovictoria_value(
            payload_data.get("geovictoria_id"), "GeoVictoria ID"
        )
    if "geovictoria_identifier" in payload_data:
        payload_data["geovictoria_identifier"] = _normalize_geovictoria_value(
            payload_data.get("geovictoria_identifier"), "GeoVictoria identifier"
        )
    if "geovictoria_id" in payload_data or "geovictoria_identifier" in payload_data:
        _ensure_geovictoria_unique(
            db,
            geovictoria_id=payload_data.get("geovictoria_id"),
            geovictoria_identifier=payload_data.get("geovictoria_identifier"),
            worker_id=worker.id,
        )
    if payload.supervisor_id is not None and not db.get(
        WorkerSupervisor, payload.supervisor_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Supervisor not found"
        )
    if payload.assigned_station_ids is not None:
        stations = list(
            db.execute(
                select(Station.id).where(Station.id.in_(payload.assigned_station_ids))
            ).all()
        )
        if len(stations) != len(set(payload.assigned_station_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more stations not found",
            )
    for key, value in payload_data.items():
        setattr(worker, key, value)
    db.commit()
    db.refresh(worker)
    return worker


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_worker(worker_id: int, db: Session = Depends(get_db)) -> None:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    db.delete(worker)
    db.commit()


@router.get("/{worker_id}/skills", response_model=list[SkillRead])
def list_worker_skills(worker_id: int, db: Session = Depends(get_db)) -> list[Skill]:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    stmt = select(Skill).join(WorkerSkill, WorkerSkill.skill_id == Skill.id).where(
        WorkerSkill.worker_id == worker_id
    )
    return list(db.execute(stmt).scalars())


@router.put("/{worker_id}/skills", response_model=list[SkillRead])
def set_worker_skills(
    worker_id: int, payload: SkillAssignment, db: Session = Depends(get_db)
) -> list[Skill]:
    worker = db.get(Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    if payload.skill_ids:
        skills = list(
            db.execute(select(Skill).where(Skill.id.in_(payload.skill_ids))).scalars()
        )
        if len(skills) != len(set(payload.skill_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more skills not found",
            )
    else:
        skills = []
    db.query(WorkerSkill).filter(WorkerSkill.worker_id == worker_id).delete()
    for skill in skills:
        db.add(WorkerSkill(worker_id=worker_id, skill_id=skill.id))
    db.commit()
    return skills
