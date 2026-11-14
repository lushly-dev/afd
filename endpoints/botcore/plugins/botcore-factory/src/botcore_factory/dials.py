"""The factory's dials: defaults, kinds and the range ``dial-set`` accepts.

The lane state keeps only the values someone set; every other dial reads its default. The
``review.*`` dials belong to the owner: ``dial-set`` on one needs a person's confirmation,
which botcore's host does not carry yet, so it is refused until it does.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Dial:
    key: str
    default: Any
    kind: str  # "int", "number", "percent" or "bool"
    minimum: float | None = None
    maximum: float | None = None
    trades: str = ""
    owner_only: bool = False

    def describe(self, value: Any) -> dict:
        return {"key": self.key, "value": value, "default": self.default}


def _int(key, default, low, high, trades):
    return Dial(key, default, "int", low, high, trades)


DIALS: dict[str, Dial] = {
    dial.key: dial
    for dial in (
        # lane.slots' maximum is the lane host's suggestedSlots; see slots_ceiling.
        _int("lane.slots", 1, 1, None, "Validation concurrency against re-runs when main moves"),
        _int("cells.max", 3, 1, 32, "Ready branches against host load and allowance"),
        _int("cells.issuesMax", 1, 1, 5, "Small PRs against fewer cells for related issues"),
        Dial("host.minFreeGb", 8, "number", 0, 1024, "Room kept free on the host for validation"),
        _int("lane.queueTarget", 2, 1, 100, "When the foreman starts another cell"),
        _int("lane.queueMax", 10, 1, 100, "Queued branches before new ones are held"),
        Dial("plans.ceiling", 85, "percent", 1, 100, "Factory use of a plan's week"),
        Dial("fable.ceiling", 50, "percent", 0, 100, "Ordinary Fable routes against hard cases"),
        _int("lane.coverageEvery", 5, 1, 100, "Merges between coverage runs on main"),
        Dial("claims.leaseHours", 24, "number", 1, 168, "How long a silent claim holds an issue"),
        _int("cells.maxEjections", 3, 1, 10, "Repair attempts before a branch is parked"),
        Dial("experience.hold", False, "bool", trades="Merging UI changes at once or seeing them"),
        Dial("lane.autostart", True, "bool", trades="Restarting the lane with the host"),
        _int("logs.keepDays", 30, 1, 365, "Disk against history"),
        Dial("review.enabled", True, "bool", trades="The improvement loop at all", owner_only=True),
        *(
            Dial(key, default, "int", 1, high, owner_only=True)
            for key, default, high in (
                ("review.minHours", 12, 168),
                ("review.baselineDays", 7, 90),
                ("review.minMerges", 10, 1000),
                ("review.minLaneHours", 4, 168),
                ("review.maxChecks", 4, 52),
                ("review.memoryDays", 30, 365),
                ("review.maxBadVerdicts", 3, 20),
                ("review.cellsMax", 1, 32),
                ("review.issuesMax", 3, 50),
            )
        ),
    )
}


def values(overrides: dict[str, Any]) -> dict[str, Any]:
    """Every dial's current value: the set value, else the default."""
    return {key: overrides.get(key, dial.default) for key, dial in DIALS.items()}


def value(overrides: dict[str, Any], key: str) -> Any:
    return overrides.get(key, DIALS[key].default)


def check(dial: Dial, raw: Any, maximum: float | None = None) -> str | None:
    """Why ``raw`` is not a value ``dial`` accepts, or None when it is."""
    high = dial.maximum if maximum is None else maximum
    if dial.kind == "bool":
        return None if isinstance(raw, bool) else f"{dial.key} takes true or false"
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return f"{dial.key} takes a number"
    if dial.kind == "int" and not float(raw).is_integer():
        return f"{dial.key} takes a whole number"
    if (dial.minimum is not None and raw < dial.minimum) or (high is not None and raw > high):
        bounds = f"between {_show(dial.minimum)} and {_show(high)}"
        return f"{dial.key} must be {bounds}; {_show(raw)} is out of range"
    return None


def normalize(dial: Dial, raw: Any) -> Any:
    return int(raw) if dial.kind == "int" else raw


def _show(number: float | None) -> str:
    if number is None:
        return "unbounded"
    return str(int(number)) if float(number).is_integer() else str(number)
