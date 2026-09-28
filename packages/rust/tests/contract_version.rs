//! `afd::CONTRACT_VERSION` matches the contract version in `spec/VERSION`.

use std::path::PathBuf;

#[test]
fn contract_version_matches_spec() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/VERSION");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    assert_eq!(afd::CONTRACT_VERSION, text.trim());
}

#[test]
fn contract_version_is_major_minor() {
    let (release, _pre_release) = afd::CONTRACT_VERSION
        .split_once('-')
        .unwrap_or((afd::CONTRACT_VERSION, ""));
    let parts: Vec<&str> = release.split('.').collect();
    assert_eq!(
        parts.len(),
        2,
        "{} is not MAJOR.MINOR",
        afd::CONTRACT_VERSION
    );
    assert!(parts
        .iter()
        .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())));
}
