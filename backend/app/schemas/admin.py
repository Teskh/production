from pydantic import BaseModel, ConfigDict

from app.models.enums import AdminRole


class AdminLoginRequest(BaseModel):
    first_name: str
    last_name: str
    pin: str


class AdminUserRead(BaseModel):
    id: int
    first_name: str
    last_name: str
    role: AdminRole

    model_config = ConfigDict(from_attributes=True)
