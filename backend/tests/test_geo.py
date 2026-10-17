import math

import pytest

from routing.services.geo import (
    ProjectedPolyline,
    cumulative_miles,
    haversine_mi,
    overlap_fraction,
    point_at_distance,
    resample_by_count,
    simplify,
    simplify_to_max,
)


def test_haversine_known_distance():
    # One degree of latitude ~ 69.09 mi
    assert haversine_mi((0, 0), (0, 1)) == pytest.approx(69.09, abs=0.05)
    # Dallas -> Denver straight line ~ 663 mi
    assert haversine_mi((-96.797, 32.7767), (-104.9903, 39.7392)) == pytest.approx(663, abs=3)


def test_point_at_distance_interpolates():
    coords = [(0.0, 0.0), (0.0, 1.0), (0.0, 2.0)]
    cum = cumulative_miles(coords)
    lon, lat = point_at_distance(coords, cum, cum[-1] * 0.75)
    assert lon == 0 and lat == pytest.approx(1.5)
    assert point_at_distance(coords, cum, -5) == coords[0]
    assert point_at_distance(coords, cum, 1e9) == coords[-1]


def test_distance_to_polyline():
    line = ProjectedPolyline([(-100.0, 40.0), (-99.0, 40.0)])
    # 0.1 deg lat north of the line ~ 11.1 km
    assert line.distance_km((-99.5, 40.1)) == pytest.approx(11.1, abs=0.1)
    # beyond the end: distance to the endpoint
    assert line.distance_km((-98.9, 40.0)) == pytest.approx(8.5, abs=0.2)
    assert line.distance_km((-90, 40), cutoff_km=40) == math.inf


def test_simplify_keeps_shape_and_endpoints():
    zig = [(i * 0.01, 0.0 if i % 2 else 0.00001) for i in range(1000)] + [(10.0, 1.0)]
    out = simplify(zig, tolerance_km=0.05)
    assert out[0] == zig[0] and out[-1] == zig[-1]
    assert len(out) < 10
    assert len(simplify_to_max(zig, 50)) <= 50


def test_resample_by_count_even_spacing():
    pts = resample_by_count([(0, 0), (0, 10)], 11)
    assert len(pts) == 11
    assert [round(p[1], 6) for p in pts] == [float(i) for i in range(11)]


def test_overlap_fraction():
    a = [(0.0, 0.0), (1.0, 0.0)]
    same = [(0.0, 0.001), (1.0, 0.001)]  # ~110 m away
    half = [(0.5, 0.0), (1.0, 0.0), (1.0, 0.5)]  # first half shared, second half far
    assert overlap_fraction(same, ProjectedPolyline(a), 1.0) == 1.0
    assert 0.4 < overlap_fraction(half, ProjectedPolyline(a), 1.0) < 0.6
