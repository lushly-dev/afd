//! HTML from a stranger: read without panicking, hidden text kept apart,
//! and cleaned for display with its remote references bounded.
#![no_main]

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    if let Ok(html) = std::str::from_utf8(bytes) {
        let reading = loam_mail::html::read(html);
        assert!(reading.links.len() <= 500);
        let cleaned = loam_mail::html::clean(html);
        assert!(cleaned.remote.len() <= 200);
        assert!(!cleaned.html.contains("<script"));
    }
});
