//! The write scan's expected noise on ordinary documents (specification section 11): the rate at
//! which `instruction-like` and `hidden-text` fire on this repository's own markdown, which is
//! the nearest thing to ordinary documents the crate can read. The numbers are printed so the
//! pull request can record them; the assertions only keep the scan from becoming useless
//! (flagging most files) or silent.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use umbel_okf::{Ingest, Kind, analyze};
use umbel_store::Flag;

fn collect(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if matches!(
            name.as_ref(),
            "node_modules" | "target" | ".git" | "dist" | "vendor"
        ) || path.is_symlink()
        {
            continue;
        }
        if path.is_dir() {
            collect(&path, found);
        } else if name.ends_with(".md") {
            found.push(path);
        }
    }
}

#[test]
fn the_scan_flags_a_few_percent_of_ordinary_documents() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut files = Vec::new();
    for sub in [
        "docs",
        "endpoints/umbel/docs",
        "packages",
        ".claude/skills",
        "spec",
    ] {
        collect(&root.join(sub), &mut files);
    }
    files.sort();
    let (mut total, mut instruction, mut hidden, mut unreadable) = (0usize, 0usize, 0usize, 0usize);
    let mut flagged_files = Vec::new();
    for path in &files {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .display()
            .to_string();
        match analyze(&Ingest::new(&bytes, "x.md", Kind::Markdown, "document")) {
            Ok(analysis) => {
                total += 1;
                if analysis.flags.contains(&Flag::InstructionLike) {
                    instruction += 1;
                    flagged_files.push(relative.clone());
                }
                if analysis.flags.contains(&Flag::HiddenText) {
                    hidden += 1;
                    flagged_files.push(format!("{relative} (hidden)"));
                }
            }
            Err(_) => unreadable += 1,
        }
    }
    assert!(
        total > 300,
        "expected a corpus of ordinary documents, found {total}"
    );
    println!(
        "FLAG RATE: {total} markdown files, {instruction} instruction-like ({:.1}%), {hidden} hidden-text ({:.1}%), {unreadable} unreadable frontmatter",
        100.0 * instruction as f64 / total as f64,
        100.0 * hidden as f64 / total as f64,
    );
    for file in flagged_files.iter().take(15) {
        println!("  flagged: {file}");
    }
    assert!(
        (instruction as f64) / (total as f64) < 0.25,
        "the scan flags more than a quarter of ordinary documents: {instruction} of {total}"
    );
}
