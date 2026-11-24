#![no_main]

use afd::pipeline::{
    evaluate_condition, resolve_reference, try_resolve_variables, PipelineCondition,
    PipelineContext,
};
use libfuzzer_sys::fuzz_target;
use serde_json::Value;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        let ctx = PipelineContext::new(Some(Value::String(text.to_string())));
        let _ = resolve_reference(text, &ctx);
    }
    if let Ok(value) = serde_json::from_slice::<Value>(data) {
        let ctx = PipelineContext::new(Some(value.clone()));
        let _ = try_resolve_variables(&value, &ctx);
        if let Ok(condition) = serde_json::from_value::<PipelineCondition>(value) {
            let _ = evaluate_condition(&condition, &ctx);
        }
    }
});
