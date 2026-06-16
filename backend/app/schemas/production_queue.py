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
    condition_value_ids: list[int] = []

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


class ProductionQueueProgressCount(BaseModel):
    completed: int
    total: int
    skipped: int = 0


class ProductionQueueModuleProgressSummary(BaseModel):
    panels_finished: int
    total_panels: int
    panel_tasks: ProductionQueueProgressCount
    module_tasks: ProductionQueueProgressCount


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
    summary: ProductionQueueModuleProgressSummary
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
    house_type_id: int | None = None
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None
    sub_type_id: int | None = None
    status: WorkUnitStatus | None = None
    condition_value_ids: list[int] | None = None


class ProductionQueueBulkUpdate(BaseModel):
    work_unit_ids: list[int]
    house_type_id: int | None = None
    planned_start_datetime: datetime | None = None
    planned_assembly_line: str | None = None
    sub_type_id: int | None = None
    status: WorkUnitStatus | None = None
    condition_value_ids: list[int] | None = None


class ProductionQueueReorder(BaseModel):
    ordered_ids: list[int]


class ProductionQueueSequenceUpdateItem(BaseModel):
    work_unit_id: int
    planned_sequence: int


class ProductionQueueSequenceUpdate(BaseModel):
    updates: list[ProductionQueueSequenceUpdateItem]


class ProductionQueueBulkDelete(BaseModel):
    work_unit_ids: list[int]
