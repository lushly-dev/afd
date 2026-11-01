//! The scaffold builds and the binary answers `--version`.
#![cfg(feature = "cli")]

use std::process::Command;

#[test]
fn the_binary_prints_its_version() {
    let output = Command::new(env!("CARGO_BIN_EXE_umbel"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(output.status.success());
    let expected = format!("umbel {}\n", env!("CARGO_PKG_VERSION"));
    assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
}
