//! Fitting a result to the call's output budget (specification section 8.6, decision D64).
//!
//! The handler reads the effective budget from the call (`CallContext::output_budget`) and
//! shrinks its result structurally: fewer hits, a shorter window, fewer list entries. It never
//! cuts a JSON value in the middle. AFD's own check after the handler is the backstop: a result
//! that still does not fit is refused as `OUTPUT_BUDGET_EXCEEDED`, never truncated.

use serde_json::Value;
use umbel_sdk::Outcome;

/// The bytes AFD measures: the UTF-8 length of the result's canonical JSON without its
/// `metadata`. Keys sorted changes no length; a float with no fraction is written as an integer,
/// as JavaScript writes it, which is the one place `serde_json` spells a number longer.
pub(crate) fn size(outcome: &Outcome) -> u64 {
    let mut value = outcome.as_value().clone();
    if let Some(map) = value.as_object_mut() {
        map.remove("metadata");
    }
    whole_numbers(&mut value);
    serde_json::to_string(&value).map_or(u64::MAX, |text| text.len() as u64)
}

/// Write a float with no fraction as the integer JavaScript writes (`1.0` is `1`).
fn whole_numbers(value: &mut Value) {
    match value {
        Value::Number(number) => {
            if let Some(float) = number.as_f64()
                && number.is_f64()
                && float.fract() == 0.0
                && float.abs() < 9.0e15
            {
                *value = Value::from(float as i64);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(whole_numbers),
        Value::Object(map) => map.values_mut().for_each(whole_numbers),
        _ => {}
    }
}

/// Whether `outcome` fits in `budget` (always when there is none).
pub(crate) fn fits(outcome: &Outcome, budget: Option<u64>) -> bool {
    budget.is_none_or(|limit| size(outcome) <= limit)
}

/// The largest `kept` in `0..=total` for which `build(kept)` fits, and its result. The result is
/// assumed to shrink as `kept` falls; when even `build(0)` does not fit, that is returned and
/// AFD's check refuses it.
pub(crate) fn fit_count(
    total: usize,
    budget: Option<u64>,
    build: impl Fn(usize) -> Outcome,
) -> (usize, Outcome) {
    let full = build(total);
    if fits(&full, budget) {
        return (total, full);
    }
    let (mut low, mut high) = (0usize, total);
    // Invariant: `build(high)` does not fit; `low` is the best known to fit (or 0).
    while high - low > 1 {
        let middle = low + (high - low) / 2;
        if fits(&build(middle), budget) {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low, build(low))
}
