//! A message held in parts: a structure as the store keeps it, then bytes
//! given to every part. Read back, numbered, written out and read without
//! failing or panicking, within the limits of the specification's 6.4.
#![no_main]

use std::collections::BTreeMap;

use loam_mail::parts::{Structure, assemble, body_fields, text_places};

libfuzzer_sys::fuzz_target!(|bytes: &[u8]| {
    // The structure, then a NUL, then the bytes each part holds.
    let (text, held) = match bytes.iter().position(|byte| *byte == 0) {
        Some(at) => (&bytes[..at], &bytes[at + 1..]),
        None => (bytes, &[][..]),
    };
    let Ok(text) = std::str::from_utf8(text) else {
        return;
    };
    let Some(structure) = Structure::from_json(text) else {
        return;
    };
    let places = structure.places();
    assert!(places.len() <= 4 * loam_mail::parts::MOST_PARTS);
    let _ = text_places(&structure);
    let held: BTreeMap<String, Vec<u8>> = places
        .iter()
        .take(8)
        .map(|(place, _)| (place.clone(), held.to_vec()))
        .collect();
    let _ = assemble(&structure, &held);
    let fields = body_fields(&structure, &held);
    assert!(fields.text.len() <= 2 * 1024 * 1024);
    assert!(fields.parts.len() <= 1000);
});
