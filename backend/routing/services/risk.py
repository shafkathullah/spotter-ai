"""Per-checkpoint weather risk classification (thresholds + load rules from the spec).

Levels: 0 Low, 1 Moderate, 2 High, 3 Severe, 4 No Travel.

Boundary convention (documented in README "Assumptions"):
  * Lower bound inclusive, upper bound exclusive: wind 25 -> Moderate, 34.99 -> Moderate, 35 -> High.
  * The table's top bucket for rain/snow is written ">1.00" / ">3.0", so exactly 1.00 in/hr rain
    and exactly 3.0 in/hr snow are still Severe; anything strictly above is No Travel.
  * Wind's top bucket is ">=55", so 55 mph is No Travel.
  * Nothing is rounded to whole units before classification. weather.py only quantizes inputs to
    3 decimals (Open-Meteo's own resolution), which strips float noise such as
    0.01 + 0.09 = 0.09999999999999999 so a value exactly on a threshold gets that threshold's level.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL = 0, 1, 2, 3, 4
LEVEL_LABELS = ("Low", "Moderate", "High", "Severe", "No Travel")
LEVEL_KEYS = ("low", "moderate", "high", "severe", "no_travel")

WIND_NO_TRAVEL_MPH = 55.0
WIND_SEVERE_MPH = 45.0
WIND_HIGH_MPH = 35.0
WIND_MODERATE_MPH = 25.0

HEAVY_LOAD_NO_TRAVEL_LB = 30_000  # > this with 45-54 mph wind -> No Travel
HEAVY_LOAD_SEVERE_LB = 40_000  # > this with 35-44 mph wind -> Severe


def wind_level(mph: float) -> int:
    if mph >= WIND_NO_TRAVEL_MPH:
        return NO_TRAVEL
    if mph >= WIND_SEVERE_MPH:
        return SEVERE
    if mph >= WIND_HIGH_MPH:
        return HIGH
    if mph >= WIND_MODERATE_MPH:
        return MODERATE
    return LOW


def rain_level(in_hr: float) -> int:
    if in_hr > 1.00:
        return NO_TRAVEL
    if in_hr >= 0.50:
        return SEVERE
    if in_hr >= 0.25:
        return HIGH
    if in_hr >= 0.10:
        return MODERATE
    return LOW


def snow_level(in_hr: float) -> int:
    if in_hr > 3.0:
        return NO_TRAVEL
    if in_hr >= 2.0:
        return SEVERE
    if in_hr >= 1.0:
        return HIGH
    if in_hr >= 0.5:
        return MODERATE
    return LOW


def load_adjusted_wind_level(mph: float, load_lb: float) -> int:
    """Wind level after the load rules. Load rules only ever raise the wind level."""
    base = wind_level(mph)
    if mph >= WIND_NO_TRAVEL_MPH:
        return NO_TRAVEL
    if WIND_SEVERE_MPH <= mph < WIND_NO_TRAVEL_MPH and load_lb > HEAVY_LOAD_NO_TRAVEL_LB:
        return NO_TRAVEL
    if WIND_HIGH_MPH <= mph < WIND_SEVERE_MPH and load_lb > HEAVY_LOAD_SEVERE_LB:
        return max(base, SEVERE)
    return base


def _trunc(x: float, places: int) -> str:
    """Truncate (not round) for display so a value never appears to cross a threshold:
    44.96 mph shows as '44.9' (High), never '45' (Severe). Trailing zeros trimmed: 38.0 -> '38'."""
    f = 10**places
    return f"{math.floor(x * f + 1e-9) / f:.{places}f}".rstrip("0").rstrip(".")


def level_label(level: int) -> str:
    return LEVEL_LABELS[level]


@dataclass(frozen=True)
class Assessment:
    wind: int
    wind_load_adjusted: int
    rain: int
    snow: int
    level: int
    drivers: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return LEVEL_LABELS[self.level]

    def levels_dict(self) -> dict[str, int]:
        return {
            "wind": self.wind,
            "wind_load_adjusted": self.wind_load_adjusted,
            "rain": self.rain,
            "snow": self.snow,
        }


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> Assessment:
    """Full checkpoint assessment with human-readable reasons for every non-Low condition."""
    w = wind_level(wind_mph)
    wa = load_adjusted_wind_level(wind_mph, load_lb)
    r = rain_level(rain_in_hr)
    s = snow_level(snow_in_hr)
    drivers: list[str] = []
    if wa > w:
        drivers.append(f"Wind {_trunc(wind_mph, 1)} mph + {load_lb:,.0f} lb load -> {LEVEL_LABELS[wa]}")
    elif w > LOW:
        drivers.append(f"Wind {_trunc(wind_mph, 1)} mph -> {LEVEL_LABELS[w]}")
    if r > LOW:
        drivers.append(f"Rain {_trunc(rain_in_hr, 2)} in/hr -> {LEVEL_LABELS[r]}")
    if s > LOW:
        drivers.append(f"Snow {_trunc(snow_in_hr, 2)} in/hr -> {LEVEL_LABELS[s]}")
    return Assessment(wind=w, wind_load_adjusted=wa, rain=r, snow=s, level=max(wa, r, s), drivers=drivers)


def risk_level(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> int:
    """Fast path (no driver strings) for heatmap cells."""
    return max(load_adjusted_wind_level(wind_mph, load_lb), rain_level(rain_in_hr), snow_level(snow_in_hr))
