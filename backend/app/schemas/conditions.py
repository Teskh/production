from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ConditionValueBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ConditionValueCreate(ConditionValueBase):
    condition_type_id: int


class ConditionValueUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)


class ConditionValueRead(ConditionValueBase):
    id: int
    condition_type_id: int

    model_config = ConfigDict(from_attributes=True)


class ConditionTypeBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    active: bool = True


class ConditionTypeCreate(ConditionTypeBase):
    pass


class ConditionTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    active: bool | None = None


class ConditionTypeRead(ConditionTypeBase):
    id: int
    values: list[ConditionValueRead] = []

    model_config = ConfigDict(from_attributes=True)


class TaskConditionRuleBase(BaseModel):
    condition_type_id: int
    house_type_id: int | None = None
    mode: Literal["is", "is_not"] = "is"
    condition_value_ids: list[int] = Field(min_length=1)


class TaskConditionRuleRead(TaskConditionRuleBase):
    id: int
    task_definition_id: int


class TaskConditionRulesUpdate(BaseModel):
    rules: list[TaskConditionRuleBase]


class WorkUnitConditionRead(BaseModel):
    work_unit_id: int
    condition_value_id: int

    model_config = ConfigDict(from_attributes=True)


class WorkUnitConditionsUpdate(BaseModel):
    condition_value_ids: list[int]


class WorkUnitConditionsBulkUpdate(BaseModel):
    work_unit_ids: list[int] = Field(min_length=1)
    add_value_ids: list[int] = []
    remove_value_ids: list[int] = []
    replace_value_ids: list[int] | None = None
