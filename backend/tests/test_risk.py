import pytest

from routing.services.risk import (
    HIGH,
    LOW,
    MODERATE,
    NO_TRAVEL,
    SEVERE,
    assess,
    load_adjusted_wind_level,
    rain_level,
    risk_level,
    snow_level,
    wind_level,
)


@pytest.mark.parametrize(
    "mph,level",
    [
        (0, LOW),
        (24.99, LOW),
        (25, MODERATE),
        (34.99, MODERATE),
        (35, HIGH),
        (44.99, HIGH),
        (45, SEVERE),
        (54.99, SEVERE),
        (55, NO_TRAVEL),
        (80, NO_TRAVEL),
    ],
)
def test_wind_boundaries(mph, level):
    assert wind_level(mph) == level


@pytest.mark.parametrize(
    "inches,level",
    [
        (0.0, LOW),
        (0.0999, LOW),
        (0.10, MODERATE),
        (0.2499, MODERATE),
        (0.25, HIGH),
        (0.4999, HIGH),
        (0.5, SEVERE),
        (1.0, SEVERE),  # table says ">1.00" for No Travel, so exactly 1.00 is Severe
        (1.0001, NO_TRAVEL),
    ],
)
def test_rain_boundaries(inches, level):
    assert rain_level(inches) == level


@pytest.mark.parametrize(
    "inches,level",
    [
        (0.0, LOW),
        (0.4999, LOW),
        (0.5, MODERATE),
        (0.9999, MODERATE),
        (1.0, HIGH),
        (1.9999, HIGH),
        (2.0, SEVERE),
        (3.0, SEVERE),  # ">3.0" for No Travel
        (3.0001, NO_TRAVEL),
    ],
)
def test_snow_boundaries(inches, level):
    assert snow_level(inches) == level


@pytest.mark.parametrize("load", [1, 30_000, 30_001, 40_000, 40_001, 80_000])
def test_55_mph_is_no_travel_for_any_load(load):
    assert load_adjusted_wind_level(55, load) == NO_TRAVEL


@pytest.mark.parametrize(
    "mph,load,level",
    [
        # 45-54 mph: > 30,000 lb -> No Travel
        (45, 30_000, SEVERE),
        (45, 30_001, NO_TRAVEL),
        (54.99, 30_000, SEVERE),
        (54.99, 30_001, NO_TRAVEL),
        # 35-44 mph: > 40,000 lb -> Severe
        (35, 40_000, HIGH),
        (35, 40_001, SEVERE),
        (44.99, 40_000, HIGH),
        (44.99, 40_001, SEVERE),
        # 35-44 mph with a 30-40k load is untouched (only the >30k rule applies at 45+)
        (40, 35_000, HIGH),
        # Below 35 mph no load rule applies
        (34.99, 80_000, MODERATE),
        (24.99, 80_000, LOW),
    ],
)
def test_load_rules(mph, load, level):
    assert load_adjusted_wind_level(mph, load) == level


def test_checkpoint_level_is_max_of_conditions():
    a = assess(wind_mph=10, rain_in_hr=0.3, snow_in_hr=0.6, load_lb=10_000)
    assert (a.wind, a.wind_load_adjusted, a.rain, a.snow) == (LOW, LOW, HIGH, MODERATE)
    assert a.level == HIGH
    assert a.label == "High"
    assert a.drivers == ["Rain 0.3 in/hr -> High", "Snow 0.6 in/hr -> Moderate"]


def test_load_driver_text():
    a = assess(38, 0, 0, 42_000)
    assert (a.wind, a.wind_load_adjusted, a.level) == (HIGH, SEVERE, SEVERE)
    assert a.drivers == ["Wind 38 mph + 42,000 lb load -> Severe"]
    assert a.levels_dict() == {"wind": HIGH, "wind_load_adjusted": SEVERE, "rain": LOW, "snow": LOW}


def test_driver_text_never_appears_to_cross_threshold():
    # 44.96 mph is High; display must not round it up to "45".
    assert assess(44.96, 0, 0, 1).drivers == ["Wind 44.9 mph -> High"]
    assert assess(0, 0.2499, 0, 1).drivers == ["Rain 0.24 in/hr -> Moderate"]


def test_calm_has_no_drivers():
    a = assess(5, 0, 0, 80_000)
    assert a.level == LOW and a.drivers == []


@pytest.mark.parametrize(
    "w,r,s,load",
    [(38, 0, 0, 42_000), (50, 0, 0, 30_001), (10, 1.2, 0, 1), (10, 0, 2.5, 1), (60, 0, 0, 1), (0, 0, 0, 1)],
)
def test_fast_path_matches_assess(w, r, s, load):
    assert risk_level(w, r, s, load) == assess(w, r, s, load).level
