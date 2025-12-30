from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.admin import AdminUser
from app.models.stations import Station
from app.models.workers import Skill, Worker, WorkerSkill
from app.schemas.workers import (
    SkillAssignment,
    SkillCreate,
    SkillRead,
    SkillUpdate,
    WorkerCreate,
    WorkerRead,
    WorkerUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[WorkerRead])
def list_workers(db: Session = Depends(get_db)) -> list[Worker]:
    return list(db.execute(select(Worker).order_by(Worker.last_name, Worker.first_name)).scalars())


@router.post("/", response_model=WorkerRead, status_code=status.HTTP_201_CREATED)
def create_worker(payload: WorkerCreate, db: Session = Depends(get_db)) -> Worker:
    if payload.supervisor_id is not None and not db.get(AdminUser, payload.supervisor_id):
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
    worker = Worker(**payload.model_dump())
    db.add(worker)
    db.commit()
    db.refresh(worker)
    return worker


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
    if payload.supervisor_id is not None and not db.get(AdminUser, payload.supervisor_id):
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
    for key, value in payload.model_dump(exclude_unset=True).items():
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


@router.get("/skills", response_model=list[SkillRead])
def list_skills(db: Session = Depends(get_db)) -> list[Skill]:
    return list(db.execute(select(Skill).order_by(Skill.name)).scalars())


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
