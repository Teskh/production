from pydantic import BaseModel, ConfigDict


class HouseTypeBase(BaseModel):
    name: str
    number_of_modules: int


class HouseTypeCreate(HouseTypeBase):
    pass


class HouseTypeUpdate(BaseModel):
    name: str | None = None
    number_of_modules: int | None = None


class HouseTypeRead(HouseTypeBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class HouseSubTypeBase(BaseModel):
    house_type_id: int
    name: str


class HouseSubTypeCreate(BaseModel):
    name: str


class HouseSubTypeUpdate(BaseModel):
    house_type_id: int | None = None
    name: str | None = None


class HouseSubTypeRead(HouseSubTypeBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
