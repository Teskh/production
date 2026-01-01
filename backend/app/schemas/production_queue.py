from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import PanelUnitStatus, TaskStatus, WorkUnitStatus


class ProductionQueueItem(BaseModel):
    id: int
    work_order_id: int
    planned_sequence: int
    project_name: str
    house_identifier: str
    module_number: int
    house_type_id: int
    house_type_name: str
    sub_type_id: int | None = None
    sub_type_name: str | None = None
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None
    status: WorkUnitStatus

    model_config = ConfigDict(from_attributes=True)


class ProductionQueuePanelTask(BaseModel):
    task_definition_id: int
    name: str
    status: TaskStatus


class ProductionQueuePanelStatus(BaseModel):
    panel_definition_id: int
    panel_unit_id: int | None = None
    panel_code: str | None = None
    status: PanelUnitStatus
    current_station_id: int | None = None
    current_station_name: str | None = None
    pending_tasks: list[ProductionQueuePanelTask]


class ProductionQueueModuleStatus(BaseModel):
    work_unit_id: int
    work_order_id: int
    project_name: str
    house_identifier: str
    module_number: int
    house_type_id: int
    house_type_name: str
    sub_type_id: int | None = None
    sub_type_name: str | None = None
    status: WorkUnitStatus
    planned_assembly_line: str | None = None
    current_station_id: int | None = None
    current_station_name: str | None = None
    panels: list[ProductionQueuePanelStatus]


class ProductionBatchCreate(BaseModel):
    project_name: str
    house_identifier_base: str
    house_type_id: int
    sub_type_id: int | None = None
    quantity: int
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None


class ProductionQueueUpdate(BaseModel):
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None
    sub_type_id: int | None = None
    status: WorkUnitStatus | None = None


class ProductionQueueBulkUpdate(BaseModel):
    work_unit_ids: list[int]
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None
    sub_type_id: int | None = None
    status: WorkUnitStatus | None = None


class ProductionQueueReorder(BaseModel):
    ordered_ids: list[int]


class ProductionQueueBulkDelete(BaseModel):
    work_unit_ids: list[int]
