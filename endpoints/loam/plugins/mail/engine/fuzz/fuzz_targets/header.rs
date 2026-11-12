//! A header block from a stranger: read without failing or panicking.
#![no_main]

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    let _ = loam_mail::derive::header_fields(bytes);
});
