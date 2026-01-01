from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import WORKER_SESSION_COOKIE, get_current_worker_session, get_db
from app.core.security import hash_token, new_session_token, session_expiry, utc_now
from app.models.workers import Worker, WorkerSession
from app.schemas.worker_sessions import (
    WorkerSessionLoginRequest,
    WorkerSessionRead,
    WorkerSessionStationUpdate,
)

router = APIRouter()

_IDLE_TIMEOUT_SECONDS = 45


@router.post("/login", response_model=WorkerSessionRead)
def worker_login(
    payload: WorkerSessionLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> WorkerSessionRead:
    worker = db.get(Worker, payload.worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    if not worker.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker inactive")
    if worker.login_required:
        if not payload.pin or worker.pin != payload.pin:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid PIN")
    token = new_session_token()
    expires_at = session_expiry()
    session = WorkerSession(
        worker_id=worker.id,
        token_hash=hash_token(token),
        created_at=utc_now(),
        expires_at=expires_at,
        station_id=payload.station_id,
    )
    db.add(session)
    db.commit()
    response.set_cookie(
        key=WORKER_SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=int((expires_at - utc_now()).total_seconds()),
    )
    return WorkerSessionRead(
        worker=worker,
        station_id=session.station_id,
        require_pin_change=worker.pin == "1111",
        idle_timeout_seconds=_IDLE_TIMEOUT_SECONDS,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def worker_logout(
    request: Request,
    response: Response,
    session: WorkerSession = Depends(get_current_worker_session),
    db: Session = Depends(get_db),
) -> None:
    token = request.cookies.get(WORKER_SESSION_COOKIE)
    if token:
        session.revoked_at = utc_now()
        db.commit()
    response.delete_cookie(WORKER_SESSION_COOKIE)


@router.get("/me", response_model=WorkerSessionRead)
def worker_me(
    session: WorkerSession = Depends(get_current_worker_session),
    db: Session = Depends(get_db),
) -> WorkerSessionRead:
    worker = db.get(Worker, session.worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Worker not found")
    if not worker.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker inactive")
    return WorkerSessionRead(
        worker=worker,
        station_id=session.station_id,
        require_pin_change=worker.pin == "1111",
        idle_timeout_seconds=_IDLE_TIMEOUT_SECONDS,
    )


@router.put("/station", response_model=WorkerSessionRead)
def update_station(
    payload: WorkerSessionStationUpdate,
    session: WorkerSession = Depends(get_current_worker_session),
    db: Session = Depends(get_db),
) -> WorkerSessionRead:
    session.station_id = payload.station_id
    db.commit()
    worker = db.get(Worker, session.worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Worker not found")
    return WorkerSessionRead(
        worker=worker,
        station_id=session.station_id,
        require_pin_change=worker.pin == "1111",
        idle_timeout_seconds=_IDLE_TIMEOUT_SECONDS,
    )
