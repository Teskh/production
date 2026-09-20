from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PanelLabelInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    work_unit_id: int = Field(gt=0)
    panel_definition_id: int = Field(gt=0)
    description: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=80)
    area: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    correlativo: str | None = Field(default=None, min_length=1, max_length=40)
    label_date: date | None = None
    copies: int = Field(default=1, ge=1, le=10)


class PanelLabelData(BaseModel):
    description: str
    process: Literal["Paneles"] = "Paneles"
    model: str
    project: str
    module: int
    area: str
    label_date: date
    correlativo: str


class PanelLabelPreview(BaseModel):
    target: PanelLabelInput
    data: PanelLabelData
    missing_fields: list[str]
    sources: dict[str, str]
    svg: str
