//! A whole message from a stranger: read without failing or panicking, with
//! its text within the limits of the specification's 6.4.
#![no_main]

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    let fields = loam_mail::derive::body_fields(bytes);
    assert!(fields.text.len() <= 2 * 1024 * 1024);
    assert!(fields.parts.len() <= 1000);
});
