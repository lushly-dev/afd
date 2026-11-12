//! Every crate in the lockfile is permissively licensed (the specification's
//! section 2), so a dependency cannot change that unnoticed.

#![allow(clippy::expect_used)]

use std::process::Command;

/// The licences a dependency may be used under. Adding one is a decision: say
/// why in the pull request that does it.
const ALLOWED: &[&str] = &[
    "0BSD",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "ISC",
    "MIT",
    "Unicode-3.0",
    "Unlicense",
    "Zlib",
];

/// Crates allowed under a licence outside [`ALLOWED`], each by name, so that no
/// other crate brings that licence in unnoticed. Each is the owner's decision.
const EXCEPTIONS: &[(&str, &str)] = &[
    // MPL-2.0 is file-level copyleft: these crates' own files stay MPL, used
    // unmodified, and nothing else of the engine is touched. `ammonia`, the
    // HTML cleaner, needs them. Allowed by the owner on 2026-11-12.
    ("cssparser", "MPL-2.0"),
    ("dtoa-short", "MPL-2.0"),
];

/// Whether an SPDX expression can be satisfied with allowed licences alone:
/// one side of an `OR`, both sides of an `AND`.
fn permitted(expression: &str) -> bool {
    // Older manifests write `MIT/Apache-2.0` for `MIT OR Apache-2.0`.
    let spaced = expression
        .replace('/', " OR ")
        .replace('(', " ( ")
        .replace(')', " ) ");
    let tokens: Vec<&str> = spaced.split_whitespace().collect();
    let mut at = 0;
    let result = any_of(&tokens, &mut at);
    result.is_some_and(|allowed| allowed && at == tokens.len())
}

/// `term (OR term)*`. `None` is an expression that does not parse.
fn any_of(tokens: &[&str], at: &mut usize) -> Option<bool> {
    let mut allowed = all_of(tokens, at)?;
    while tokens.get(*at) == Some(&"OR") {
        *at += 1;
        allowed |= all_of(tokens, at)?;
    }
    Some(allowed)
}

/// `atom (AND atom)*`.
fn all_of(tokens: &[&str], at: &mut usize) -> Option<bool> {
    let mut allowed = atom(tokens, at)?;
    while tokens.get(*at) == Some(&"AND") {
        *at += 1;
        allowed &= atom(tokens, at)?;
    }
    Some(allowed)
}

/// A licence, a licence `WITH` an exception, or a bracketed expression.
fn atom(tokens: &[&str], at: &mut usize) -> Option<bool> {
    let token = *tokens.get(*at)?;
    *at += 1;
    match token {
        "(" => {
            let allowed = any_of(tokens, at)?;
            (tokens.get(*at) == Some(&")")).then(|| {
                *at += 1;
                allowed
            })
        }
        ")" | "OR" | "AND" | "WITH" => None,
        licence => {
            // An exception only adds permissions, so the licence decides.
            if tokens.get(*at) == Some(&"WITH") {
                tokens.get(*at + 1)?;
                *at += 2;
            }
            Some(ALLOWED.contains(&licence))
        }
    }
}

#[test]
fn the_evaluator_reads_spdx_expressions() {
    for allowed in [
        "MIT",
        "MIT OR Apache-2.0",
        "MIT/Apache-2.0",
        "MIT OR Apache-2.0 OR LGPL-2.1-or-later",
        "(MIT OR Apache-2.0) AND Unicode-3.0",
        "Apache-2.0 WITH LLVM-exception OR MIT",
        "GPL-3.0-only OR (MIT AND BSD-3-Clause)",
    ] {
        assert!(permitted(allowed), "{allowed}");
    }
    for refused in [
        "GPL-3.0-only",
        "LGPL-2.1-or-later",
        "MIT AND GPL-3.0-only",
        "(MIT OR Apache-2.0) AND MPL-2.0",
        "GPL-3.0-only WITH Classpath-exception-2.0",
        "",
        "MIT OR",
        "(MIT",
        "MIT Apache-2.0",
    ] {
        assert!(!permitted(refused), "{refused}");
    }
}

#[test]
fn every_crate_in_the_lockfile_is_permissively_licensed() {
    let output = Command::new(env!("CARGO"))
        .args(["metadata", "--format-version", "1", "--locked"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("cargo metadata runs");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("cargo metadata prints JSON");
    let packages = metadata["packages"].as_array().expect("a list of packages");
    assert!(packages.len() > 1, "the lockfile's packages were read");
    let refused: Vec<String> = packages
        .iter()
        .filter(|package| {
            let licence = package["license"].as_str().unwrap_or_default();
            let excepted = EXCEPTIONS.iter().any(|(name, allowed)| {
                package["name"].as_str() == Some(name) && licence == *allowed
            });
            !excepted && !permitted(licence)
        })
        .map(|package| {
            format!(
                "{} {}: {}",
                package["name"], package["version"], package["license"]
            )
        })
        .collect();
    assert_eq!(refused, Vec::<String>::new());
}
