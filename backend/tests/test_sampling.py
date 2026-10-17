from datetime import datetime, timedelta, timezone

import pytest

from routing.services.geo import cumulative_miles
from routing.services.sampling import (
    Track,
    checkpoint_distances,
    cum_seconds_from_segments,
    cum_seconds_from_steps,
    owned_miles,
    plan_checkpoints,
    scaled_cumulative_miles,
)

DEP = datetime(2026, 10, 18, 8, 0, tzinfo=timezone(timedelta(hours=-5)))


def straight_track(total_mi: float, mph: float = 60.0) -> Track:
    """North-bound straight line of total_mi miles at constant speed."""
    deg = total_mi / 69.0
    coords = [(-100.0, 35.0 + deg * i / 100) for i in range(101)]
    cum = scaled_cumulative_miles(coords, total_mi)
    return Track(coords, cum, [c / mph * 3600 for c in cum])


@pytest.mark.parametrize(
    "total,interval,expected",
    [
        (100, 25, [0, 25, 50, 75, 100]),  # exact multiple: destination not duplicated
        (110, 25, [0, 25, 50, 75, 100, 110]),
        (110, 10, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]),
        (110, 50, [0, 50, 100, 110]),
        (7, 10, [0, 7]),  # shorter than interval: origin + destination
        (7, 25, [0, 7]),
        (7, 50, [0, 7]),
    ],
)
def test_checkpoint_distances(total, interval, expected):
    assert checkpoint_distances(total, interval) == pytest.approx(expected)


@pytest.mark.parametrize("interval", [10, 25, 50])
@pytest.mark.parametrize("total", [3.3, 25, 99.9, 795.05])
def test_owned_miles_sum_to_route_length(interval, total):
    d = checkpoint_distances(total, interval)
    owned = owned_miles(d)
    assert sum(owned) == pytest.approx(total, abs=1e-9)
    assert all(o >= 0 for o in owned)


def test_owned_miles_midpoints():
    # 0, 25, 50, 60: owns [0,12.5], [12.5,37.5], [37.5,55], [55,60]
    assert owned_miles([0, 25, 50, 60]) == pytest.approx([12.5, 25, 17.5, 5])


@pytest.mark.parametrize("interval,count", [(10, 82), (25, 34), (50, 18)])
def test_plan_checkpoint_count(interval, count):
    plans = plan_checkpoints(straight_track(805), interval, DEP)
    assert len(plans) == count
    assert plans[0].distance_mi == 0 and plans[-1].distance_mi == pytest.approx(805)
    assert [p.idx for p in plans] == list(range(count))


def test_checkpoint_positions_follow_geometry():
    t = straight_track(100)
    plans = plan_checkpoints(t, 25, DEP)
    lats = [p.lat for p in plans]
    assert lats == sorted(lats)
    assert plans[2].lat == pytest.approx(35 + 50 / 69, abs=1e-3)


def test_eta_uses_uneven_step_speeds():
    # 3 vertices on a straight line: 30 mi of city streets at 30 mph, then 60 mi of interstate at 60 mph.
    coords = [(-100.0, 35.0), (-100.0, 35.0 + 30 / 69.0), (-100.0, 35.0 + 90 / 69.0)]
    cum = scaled_cumulative_miles(coords, 90.0)
    cum_s = cum_seconds_from_steps(coords, cum, [(0, 1, 3600.0), (1, 2, 3600.0)])
    track = Track(coords, cum, cum_s)
    assert track.duration_s == pytest.approx(7200)
    assert track.elapsed_at(15) == pytest.approx(1800)  # halfway through the slow step
    assert track.elapsed_at(30) == pytest.approx(3600)
    assert track.elapsed_at(60) == pytest.approx(5400)  # halfway through the fast step
    # A flat average speed (45 mph) would put mile 30 at 40 min; we must not do that.
    assert track.elapsed_at(30) != pytest.approx(30 / 45 * 3600)
    plans = plan_checkpoints(track, 10, DEP)
    etas = {round(p.distance_mi): p.eta for p in plans}
    assert etas[10] == DEP + timedelta(minutes=20)
    assert etas[40] == DEP + timedelta(minutes=70)
    assert etas[90] == DEP + timedelta(hours=2)


def test_step_duration_spread_by_distance_within_step():
    # One step spanning 3 segments of lengths 1, 2, 1 (in degrees of lat): time splits 25/50/25%.
    coords = [(0.0, 0.0), (0.0, 1.0), (0.0, 3.0), (0.0, 4.0)]
    cum = cumulative_miles(coords)
    cum_s = cum_seconds_from_steps(coords, cum, [(0, 3, 400.0)])
    assert cum_s == pytest.approx([0, 100, 300, 400])


def test_cum_seconds_from_segments_rescales():
    assert cum_seconds_from_segments([1, 1, 2], target_total=8) == pytest.approx([0, 2, 4, 8])
    assert cum_seconds_from_segments([1, -1, 2]) == [0, 1, 1, 3]


def test_scaled_cumulative_miles_matches_provider_total():
    coords = [(0.0, 0.0), (0.0, 1.0)]
    assert scaled_cumulative_miles(coords, 70.0)[-1] == pytest.approx(70.0)
