from pydantic import BaseModel, ConfigDict


class AdminLoginRequest(BaseModel):
    first_name: str
    last_name: str
    pin: str


class AdminUserRead(BaseModel):
    id: int
    first_name: str
    last_name: str
    role: str
    active: bool

    model_config = ConfigDict(from_attributes=True)


class AdminUserCreate(BaseModel):
    first_name: str
    last_name: str
    pin: str
    role: str
    active: bool = True


class AdminUserUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    pin: str | None = None
    role: str | None = None
    active: bool | None = None
