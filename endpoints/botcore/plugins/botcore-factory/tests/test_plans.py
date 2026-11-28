"""Plan pacing: the plan whose room below plans.ceiling most needs spending before its reset is
chosen, so every plan tracks to its ceiling around its own reset."""

from __future__ import annotations

from datetime import UTC, datetime

from botcore_factory.cells import choose_plan, days_to_reset, pace
from botcore_factory.world import Plan

NOW = datetime(2030, 1, 1, tzinfo=UTC)


def test_the_owner_s_example_spends_the_plan_with_more_room_per_day():
    """10% left with a 4-day reset (2.5 a day) loses to 100% left with a 5-day reset (20 a day)."""
    nearly_spent = Plan("plan-a", "openai", 90, 43, "2030-01-05T00:00:00Z")
    untouched = Plan("plan-b", "anthropic", 0, 29, "2030-01-06T00:00:00Z")
    assert pace(nearly_spent, 100, NOW) == 2.5 and pace(untouched, 100, NOW) == 20
    assert choose_plan([nearly_spent, untouched], 100, NOW).plan == untouched


def test_room_that_resets_sooner_is_spent_first():
    soon = Plan("plan-a", "openai", 45, 90, "2030-01-02T00:00:00Z")  # 40 over 1 day
    later = Plan("plan-b", "anthropic", 5, 30, "2030-01-06T00:00:00Z")  # 80 over 5 days
    assert choose_plan([later, soon], 85, NOW).plan == soon


def test_the_ceiling_bounds_the_room_and_still_refuses():
    at = Plan("plan-a", "openai", 85, 50, "2030-01-02T00:00:00Z")
    below = Plan("plan-b", "anthropic", 84, 50, "2030-01-05T00:00:00Z")
    assert pace(below, 85, NOW) == 0.25
    assert choose_plan([at, below], 85, NOW).plan == below
    choice = choose_plan([at], 85, NOW)
    assert (choice.plan, choice.next_reset) == (None, "2030-01-02T00:00:00Z")


def test_a_stale_plan_is_never_chosen_nor_names_the_next_reset():
    """lushly-dev/afd#2691: a removed instance's cache is roomy and its reset long past."""
    stale = Plan("plan-a", "anthropic", 0, 100, "2029-12-30T00:00:00Z", "its window reset")
    full = Plan("plan-b", "anthropic", 90, 50, "2030-01-05T00:00:00Z")
    choice = choose_plan([stale, full], 85, NOW)
    assert choice.plan is None and choice.next_reset == "2030-01-05T00:00:00Z"
    roomy = Plan("plan-c", "anthropic", 10, 50, "2030-01-05T00:00:00Z")
    assert choose_plan([stale, roomy], 85, NOW).plan == roomy


def test_a_plan_without_a_reset_reads_its_window_from_the_share_elapsed():
    plan = Plan("plan-a", "openai", 0, 50, None)
    assert days_to_reset(plan, NOW) == 3.5


def test_a_reset_that_has_passed_is_close_not_infinite():
    stale = Plan("plan-a", "openai", 10, 100, "2029-12-31T00:00:00Z")
    assert days_to_reset(stale, NOW) == 1 / 24 and pace(stale, 85, NOW) == 75 * 24


async def test_plan_list_and_lane_status_show_the_pace(make_run):
    run = make_run("fresh")  # plan-a: 75 room over 7 days; plan-b: 45 over 9.
    listed = (await run.call("plan_list")).data
    by_id = {plan["id"]: plan for plan in listed["plans"]}
    assert (by_id["plan-a"]["pace"], by_id["plan-a"]["daysToReset"]) == (10.71, 7.0)
    assert (by_id["plan-b"]["pace"], by_id["plan-b"]["daysToReset"]) == (5.0, 9.0)
    assert listed["next"] == "plan-a"
    status = (await run.call("lane_status")).data
    assert status["plan"]["id"] == "plan-a" and status["plan"]["pace"] == 10.71
