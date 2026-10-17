import pytest

from routing.services.recommend import format_duration, recommend, sort_key, summarize
from routing.services.risk import LEVEL_KEYS


def S(rid, duration_h=10.0, no_travel=0.0, severe=0.0, high=0.0, moderate=0.0, low=100.0, avg=None):
    """Build a summary from miles per level; avg_risk derived unless overridden."""
    miles = dict(zip(LEVEL_KEYS, (low, moderate, high, severe, no_travel), strict=False))
    levels, owned = [], []
    for lvl, key in enumerate(LEVEL_KEYS):
        if miles[key]:
            levels.append(lvl)
            owned.append(miles[key])
    s = summarize(rid, f"Route {rid}", duration_h * 3600, levels, owned)
    if avg is not None:
        s = type(s)(s.id, s.name, s.duration_s, s.miles_by_level, avg, s.max_level)
    return s


def winner(*summaries):
    return recommend(list(summaries)).winner.id


def test_summarize_miles_avg_and_max():
    s = summarize("A", "Route A", 3600, [0, 2, 3, 0], [10, 5, 5, 30])
    assert s.miles_by_level == {"low": 40, "moderate": 0, "high": 5, "severe": 5, "no_travel": 0}
    assert s.avg_risk == pytest.approx((2 * 5 + 3 * 5) / 50)
    assert s.max_level == 3


def test_no_travel_beats_everything():
    # B has far more Severe/High miles but no No Travel miles -> B wins.
    a = S("A", duration_h=5, no_travel=0.5, low=99.5)
    b = S("B", duration_h=20, severe=60, high=40, low=0)
    assert winner(a, b) == "B"


def test_fewest_severe_first():
    a = S("A", duration_h=8, severe=10, low=90)
    b = S("B", duration_h=12, severe=5, high=50, low=45)
    assert winner(a, b) == "B"


def test_fewest_high_breaks_severe_tie():
    a = S("A", duration_h=8, severe=5, high=30, low=65)
    b = S("B", duration_h=12, severe=5, high=10, moderate=80, low=5)
    assert winner(a, b) == "B"


def test_average_risk_breaks_high_tie():
    a = S("A", duration_h=8, high=10, moderate=80, low=10)
    b = S("B", duration_h=12, high=10, moderate=10, low=80)
    assert winner(a, b) == "B"


def test_duration_breaks_full_tie():
    a = S("A", duration_h=12)
    b = S("B", duration_h=8)
    assert winner(a, b) == "B"


def test_float_noise_does_not_decide():
    # Severe miles differ by 0.02 (rounds to same 0.1) -> falls through to duration.
    a = S("A", duration_h=8, severe=5.01, low=94.99)
    b = S("B", duration_h=9, severe=4.99, low=95.01)
    assert sort_key(a)[1] == sort_key(b)[1] == 5.0
    # avg risk differs by < 0.005 -> treated as tie
    c = S("C", duration_h=7, avg=0.301)
    d = S("D", duration_h=6, avg=0.299)
    assert winner(c, d) == "D"
    assert winner(a, b) == "A"


def test_ranking_order_and_explanation():
    a = S("A", duration_h=8, severe=10, low=90)
    b = S("B", duration_h=9, high=20, low=80)
    c = S("C", duration_h=10, high=20, low=80)
    rec = recommend([a, b, c])
    assert [s.id for s in rec.ranked] == ["B", "C", "A"]
    assert rec.no_safe_route is False
    assert rec.explanation.startswith("Route B is recommended.")
    assert "Compared with Route C: neither has No Travel or Severe miles; same High miles (20.0)" in rec.explanation
    assert "faster (9 h 00 min vs 10 h 00 min)" in rec.explanation
    assert "Compared with Route A: neither has No Travel miles; fewer Severe miles (0.0 vs 10.0)" in rec.explanation


def test_no_safe_route_flag():
    a = S("A", no_travel=5, low=95, duration_h=8)
    b = S("B", no_travel=2, low=98, duration_h=9)
    rec = recommend([a, b])
    assert rec.no_safe_route is True
    assert rec.winner.id == "B"
    assert rec.warnings and "No Travel" in rec.warnings[0]
    assert rec.explanation.startswith("No route avoids No Travel conditions; Route B is the least risky.")


def test_single_route():
    rec = recommend([S("A")])
    assert rec.explanation == "Route A is the only route found."


def test_format_duration():
    assert format_duration(14 * 3600 + 20 * 60) == "14 h 20 min"
    assert format_duration(45 * 60) == "45 min"


def test_tiny_no_travel_tail_is_never_treated_as_clean():
    # Destination checkpoint owns 0.02 mi (50.04 mi route, 25 mi interval) and is No Travel.
    a = summarize("A", "Route A", 3600, [0, 0, 0, 4], [12.5, 25, 12.51, 0.02])
    b = S("B", duration_h=2, low=50)
    assert a.max_level == 4 and sort_key(a)[0] == 0.1
    rec = recommend([a, b])
    assert rec.winner.id == "B" and rec.no_safe_route is False
    assert "Compared with Route A: fewer No Travel miles (0.0 vs <0.1)" in rec.explanation


def test_no_safe_route_and_explanation_agree_on_tiny_no_travel():
    tails = [summarize(r, f"Route {r}", 3600 * (i + 1), [0, 4], [50, 0.02]) for i, r in enumerate("ABC")]
    rec = recommend(tails)
    assert rec.no_safe_route is True
    assert rec.explanation.startswith("No route avoids No Travel conditions; Route A is the least risky.")
    assert "neither has No Travel" not in rec.explanation
    assert "same No Travel miles (<0.1)" in rec.explanation


def test_warning_names_the_real_worst_level():
    # No Travel checkpoint owning zero miles: not counted as miles, but the warning must not say Severe.
    zero_owned = summarize("A", "Route A", 3600, [0, 4], [50, 0.0])
    rec = recommend([zero_owned])
    assert rec.warnings == ["Route A still includes No Travel conditions; check the highlighted checkpoints."]
    severe = recommend([S("A", severe=5, low=95)])
    assert severe.warnings == ["Route A still includes Severe conditions; check the highlighted checkpoints."]


def test_float_noise_mileage_counts_as_zero():
    assert sort_key(S("A", severe=1e-9, low=100))[1] == 0.0
