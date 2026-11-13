//! Fitting a result to the call's output budget (D64), as the memory plugin does
//! (`plugins/memory/src/budget.rs`): the handler shrinks its answer structurally, fewer items or
//! fewer candidates, and never cuts a JSON value. AFD's own check after the handler is the
//! backstop: a result that still does not fit is refused, never truncated.

use serde_json::{Value, json};
use umbel_sdk::Outcome;

/// The bytes AFD measures: the UTF-8 length of the result's JSON without its `metadata`, with a
/// float that has no fraction written as an integer, as JavaScript writes it.
fn size(outcome: &Outcome) -> u64 {
    let mut value = outcome.as_value().clone();
    if let Some(map) = value.as_object_mut() {
        map.remove("metadata");
    }
    whole_numbers(&mut value);
    serde_json::to_string(&value).map_or(u64::MAX, |text| text.len() as u64)
}

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
fn fits(outcome: &Outcome, budget: Option<u64>) -> bool {
    budget.is_none_or(|limit| size(outcome) <= limit)
}

/// The largest `kept` in `0..=total` for which `build(kept)` fits, and its result; `build` is
/// assumed to shrink as `kept` falls.
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

/// `RESULTS_LIMITED` when `omitted` `what` were left out to fit the budget; else unchanged.
pub(crate) fn limited(outcome: Outcome, omitted: usize, what: &str) -> Outcome {
    if omitted == 0 {
        return outcome;
    }
    outcome.with_warning_details(
        "RESULTS_LIMITED",
        &format!("{omitted} {what} were left out to fit the output budget; ask for fewer"),
        json!({ "omitted": omitted }),
    )
}
