"""Route summaries and the recommendation rule.

Ranking is a lexicographic sort on:
  (No Travel miles, Severe miles, High miles, average risk, travel time)
No Travel miles come first because they are strictly worse than Severe. Miles are compared after
rounding to 0.1 mi and average risk to 0.01 so float noise never decides a ranking. A non-zero
mileage never rounds down to 0: a checkpoint that owns 0.02 mi of No Travel still counts as 0.1, so
"has any No Travel / Severe / High" is decided exactly, and `no_safe_route`, the warnings and the
explanation all read the same key.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .risk import LEVEL_KEYS, LEVEL_LABELS, NO_TRAVEL, SEVERE

MILES_EPS = 1e-6  # below this a mileage is float noise, i.e. zero


@dataclass(frozen=True)
class RouteSummary:
    id: str
    name: str
    duration_s: float
    miles_by_level: dict[str, float]  # keys: LEVEL_KEYS
    avg_risk: float
    max_level: int

    def to_dict(self) -> dict:
        return {
            "max_level": self.max_level,
            "avg_risk": round(self.avg_risk, 3),
            "miles_by_level": {k: round(v, 2) for k, v in self.miles_by_level.items()},
        }


def summarize(
    route_id: str, name: str, duration_s: float, levels: Sequence[int], owned: Sequence[float]
) -> RouteSummary:
    miles = {k: 0.0 for k in LEVEL_KEYS}
    for lvl, m in zip(levels, owned, strict=False):
        miles[LEVEL_KEYS[lvl]] += m
    total = sum(owned)
    if total > 0:
        avg = sum(lvl * m for lvl, m in zip(levels, owned, strict=True)) / total
    else:
        avg = float(max(levels, default=0))
    return RouteSummary(route_id, name, duration_s, miles, avg, max(levels, default=0))


def key_miles(miles: float) -> float:
    """Miles as compared: 0.1 mi resolution, but any real (non-noise) mileage is at least 0.1."""
    if miles <= MILES_EPS:
        return 0.0
    return max(0.1, round(miles, 1))


def sort_key(s: RouteSummary) -> tuple:
    m = s.miles_by_level
    return (
        key_miles(m["no_travel"]),
        key_miles(m["severe"]),
        key_miles(m["high"]),
        round(s.avg_risk, 2),
        round(s.duration_s),
        s.id,
    )


_CRITERIA = (
    ("no_travel", "No Travel miles"),
    ("severe", "Severe miles"),
    ("high", "High miles"),
    ("avg_risk", "average risk"),
    ("duration", "travel time"),
)


def format_duration(seconds: float) -> str:
    minutes = int(round(seconds / 60))
    h, m = divmod(minutes, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def _fmt_mi(key: float, raw: float) -> str:
    return "<0.1" if 0 < raw < 0.05 else f"{key:.1f}"


def _compare(w: RouteSummary, other: RouteSummary) -> str:
    """Plain-English reason `w` ranks above `other`."""
    kw, ko = sort_key(w), sort_key(other)
    tied_zero: list[str] = []
    tied_nonzero: list[str] = []
    for i, (crit, label) in enumerate(_CRITERIA):
        a, b = kw[i], ko[i]
        if a == b and crit != "duration":
            if crit in ("no_travel", "severe", "high"):
                (tied_zero if a == 0 else tied_nonzero).append(
                    f"{label} ({_fmt_mi(a, w.miles_by_level[crit])})" if a else label.replace(" miles", "")
                )
            else:
                tied_nonzero.append(f"{label} ({a:.2f})")
            continue
        if crit == "duration":
            if a == b:
                return f"Compared with {other.name}: identical on every criterion"
            reason = f"faster ({format_duration(w.duration_s)} vs {format_duration(other.duration_s)})"
        elif crit == "avg_risk":
            reason = f"lower average risk ({a:.2f} vs {b:.2f})"
        else:
            reason = f"fewer {label} ({_fmt_mi(a, w.miles_by_level[crit])} vs {_fmt_mi(b, other.miles_by_level[crit])})"
        context = []
        if tied_zero:
            context.append(f"neither has {_join(tied_zero, 'or')} miles")
        if tied_nonzero:
            context.append(f"same {_join(tied_nonzero, 'and')}")
        prefix = f"{'; '.join(context)}; " if context else ""
        return f"Compared with {other.name}: {prefix}{reason}"
    return f"Compared with {other.name}: identical"


def _join(items: Sequence[str], word: str) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} {word} {items[-1]}"


@dataclass(frozen=True)
class Recommendation:
    ranked: list[RouteSummary]
    explanation: str
    no_safe_route: bool
    warnings: list[str]

    @property
    def winner(self) -> RouteSummary:
        return self.ranked[0]


def recommend(summaries: Sequence[RouteSummary]) -> Recommendation:
    if not summaries:
        raise ValueError("no routes to rank")
    ranked = sorted(summaries, key=sort_key)
    w = ranked[0]
    no_safe = all(sort_key(s)[0] > 0 for s in ranked)
    warnings: list[str] = []
    if no_safe:
        warnings.append(
            "Every route crosses No Travel conditions at the planned time. Consider delaying departure "
            "or reducing load; the recommendation is the least-bad option."
        )
    elif w.max_level >= SEVERE:
        worst = LEVEL_LABELS[min(w.max_level, NO_TRAVEL)]
        warnings.append(f"{w.name} still includes {worst} conditions; check the highlighted checkpoints.")

    if len(ranked) == 1:
        head = f"{w.name} is the only route found."
    elif no_safe:
        head = f"No route avoids No Travel conditions; {w.name} is the least risky."
    else:
        head = f"{w.name} is recommended."
    reasons = [_compare(w, other) for other in ranked[1:]]
    explanation = head + (" " + ". ".join(reasons) + "." if reasons else "")
    return Recommendation(ranked=ranked, explanation=explanation, no_safe_route=no_safe, warnings=warnings)
