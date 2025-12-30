from pydantic import BaseModel, ConfigDict


class HouseParameterBase(BaseModel):
    name: str
    unit: str | None = None


class HouseParameterCreate(HouseParameterBase):
    pass


class HouseParameterUpdate(BaseModel):
    name: str | None = None
    unit: str | None = None


class HouseParameterRead(HouseParameterBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class HouseParameterValueBase(BaseModel):
    house_type_id: int
    parameter_id: int
    module_sequence_number: int
    sub_type_id: int | None = None
    value: float


class HouseParameterValueCreate(HouseParameterValueBase):
    pass


class HouseParameterValueUpdate(BaseModel):
    house_type_id: int | None = None
    parameter_id: int | None = None
    module_sequence_number: int | None = None
    sub_type_id: int | None = None
    value: float | None = None


class HouseParameterValueRead(HouseParameterValueBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
