//! HTML from a stranger: read without panicking, hidden text kept apart.
#![no_main]

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    if let Ok(html) = std::str::from_utf8(bytes) {
        let reading = loam_mail::html::read(html);
        assert!(reading.links.len() <= 500);
    }
});
