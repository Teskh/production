from pydantic import BaseModel, ConfigDict


class AdminLoginRequest(BaseModel):
    first_name: str
    last_name: str
    pin: str


class AdminUserRead(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str | None
    role: str
    active: bool

    model_config = ConfigDict(from_attributes=True)


class AdminUserCreate(BaseModel):
    first_name: str
    last_name: str
    email: str | None = None
    pin: str
    role: str
    active: bool = True


class AdminUserUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    pin: str | None = None
    role: str | None = None
    active: bool | None = None


class AdminDashboardPermissionRead(BaseModel):
    dashboard_id: str
    roles: list[str]


class AdminDashboardPermissionUpdate(BaseModel):
    roles: list[str]


class AdminPagePermissionRole(BaseModel):
    role: str
    can_view: bool = True
    can_edit: bool = True


class AdminPagePermissionRead(BaseModel):
    page_id: str
    permissions: list[AdminPagePermissionRole]


class AdminPagePermissionUpdate(BaseModel):
    permissions: list[AdminPagePermissionRole]
