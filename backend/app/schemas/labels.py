from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


LabelFieldKey = Literal[
    "production_number",
    "project_name",
    "module_number",
    "panel_name",
]


class LabelSettings(BaseModel):
    selected_fields: list[LabelFieldKey] = Field(
        default_factory=lambda: [
            "production_number",
            "project_name",
            "module_number",
            "panel_name",
        ],
        min_length=1,
    )
    copies: int = Field(default=1, ge=1, le=10)

    @field_validator("selected_fields")
    @classmethod
    def deduplicate_selected_fields(
        cls, value: list[LabelFieldKey]
    ) -> list[LabelFieldKey]:
        return list(dict.fromkeys(value))


class ProductionLabelData(BaseModel):
    work_unit_id: int
    production_number: str
    project_name: str
    module_number: int
    panel_name: str | None = None
    scope: Literal["module", "panel"]
    source: Literal["active_task", "recent_activity", "production_queue"]
    activity_at: datetime | None = None


class LabelPrinterProfile(BaseModel):
    model: str
    dpi: int
    dots_per_mm: int
    print_width_dots: int
    label_length_dots: int
    print_width_mm: float
    label_length_mm: float
    media_type: str
    print_method: str


class LabelPrinterStatus(BaseModel):
    configured: bool
    connected: bool
    state: str
    message: str
    host: str | None = None
    port: int
    raw_status: str | None = None
    profile: LabelPrinterProfile


class LabelTestPrintResponse(BaseModel):
    sent: bool
    message: str
    bytes_sent: int
    copies: int
