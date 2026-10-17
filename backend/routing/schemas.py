"""Request validation (pydantic). Field names mirror the API contract exactly."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, field_validator

Lat = Annotated[float, Field(ge=-90, le=90)]
Lon = Annotated[float, Field(ge=-180, le=180)]


def _aware(v: datetime) -> datetime:
    if v.tzinfo is None or v.utcoffset() is None:
        raise ValueError("must be ISO 8601 with a UTC offset, e.g. 2026-10-18T08:00:00-05:00")
    return v


AwareDatetime = Annotated[datetime, AfterValidator(_aware)]


class Place(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lat: Lat
    lon: Lon
    label: str = ""


class RoutesRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    origin: Place
    destination: Place
    departure: AwareDatetime
    load_lb: Annotated[int, Field(ge=1, le=80_000, strict=False)]
    interval_mi: Literal[10, 25, 50] = 25


class HeatmapRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    departure: AwareDatetime
    load_lb: Annotated[int, Field(ge=1, le=80_000)]
    lines: Annotated[list[list[tuple[Lon, Lat]]], Field(min_length=1, max_length=5)]

    @field_validator("lines")
    @classmethod
    def _line_sizes(cls, v):
        for line in v:
            if not 1 <= len(line) <= 500:
                raise ValueError("each line must have 1-500 [lon, lat] points")
        return v


def first_error(exc: ValidationError) -> str:
    err = exc.errors()[0]
    loc = ".".join(str(p) for p in err.get("loc", ()) if not isinstance(p, int)) or "body"
    msg = err.get("msg", "invalid value").removeprefix("Value error, ")
    return f"{loc}: {msg}"
