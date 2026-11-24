#![no_main]

use libfuzzer_sys::fuzz_target;
use serde_json::Value;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = afd::approval_display::hides_characters(text);
    }
    if let Ok(value) = serde_json::from_slice::<Value>(data) {
        let _ = afd::input_digest(&value);
    }
});
