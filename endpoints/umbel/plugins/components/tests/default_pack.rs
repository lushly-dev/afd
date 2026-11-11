//! The default pack equals Specimen's exported fixture, byte for byte (specification, section 4).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use support::{read_tree, specimen_fixtures};

#[test]
fn the_default_pack_is_a_byte_equal_copy_of_specimens_exported_example() {
    let ours = read_tree(&Path::new(env!("CARGO_MANIFEST_DIR")).join("packs/library"));
    let theirs = read_tree(&specimen_fixtures().join("exported"));
    let ours: std::collections::BTreeMap<_, _> = ours
        .into_iter()
        .filter(|(path, _)| path != "pack.toml")
        .collect();
    for (path, bytes) in &theirs {
        match ours.get(path) {
            Some(mine) => assert!(mine == bytes, "{path} differs from Specimen's fixture"),
            None => panic!("{path} is missing from the default pack"),
        }
    }
    for path in ours.keys() {
        assert!(
            theirs.contains_key(path),
            "{path} is not in Specimen's fixture"
        );
    }
}
