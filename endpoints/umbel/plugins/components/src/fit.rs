//! Measuring a result as AFD measures it (specification, section 6.4), and the largest count of
//! list entries that fits. A value is never cut.

use serde_json::Value;
use umbel_sdk::Outcome;

/// The UTF-8 length of the result's compact JSON without its `metadata`; a float with no fraction
/// is written as an integer, as JavaScript writes it.
pub(crate) fn size(outcome: &Outcome) -> u64 {
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
pub(crate) fn fits(outcome: &Outcome, budget: Option<u64>) -> bool {
    budget.is_none_or(|limit| size(outcome) <= limit)
}

/// The largest `kept` in `0..total` for which `build(kept)` fits, given that `build(total)` does
/// not; `0` when nothing does, which the caller refuses.
pub(crate) fn fit_count(
    total: usize,
    budget: Option<u64>,
    build: impl Fn(usize) -> Outcome,
) -> usize {
    let (mut low, mut high) = (0usize, total);
    while high - low > 1 {
        let middle = low + (high - low) / 2;
        if fits(&build(middle), budget) {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}
