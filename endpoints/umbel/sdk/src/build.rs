//! For a plugin's `build.rs`: embed the plugin's files so `Plugin::assets` can return them.

use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Embed every file under the given directories of the plugin crate (relative to
/// `CARGO_MANIFEST_DIR`), for example `embed_assets(&["packs", "skills", "schemas"])`.
///
/// Writes `$OUT_DIR/umbel_assets.rs`, a `&[umbel_sdk::Asset]` expression that
/// [`embedded_assets!`](crate::embedded_assets) includes, and asks Cargo to rebuild when a file
/// changes. A directory that does not exist is skipped.
///
/// # Errors
/// An I/O error reading the directories or writing the file, or a non-UTF-8 file name.
pub fn embed_assets(directories: &[&str]) -> io::Result<()> {
    let manifest_dir = PathBuf::from(env_var("CARGO_MANIFEST_DIR")?);
    let out_dir = PathBuf::from(env_var("OUT_DIR")?);
    let mut files = Vec::new();
    for directory in directories {
        let root = manifest_dir.join(directory);
        if root.is_dir() {
            println!("cargo:rerun-if-changed={}", root.display());
            collect(&root, directory, &mut files)?;
        }
    }
    files.sort();
    let mut source = String::from("&[\n");
    for (relative, absolute) in files {
        println!("cargo:rerun-if-changed={}", absolute.display());
        let absolute = absolute.display().to_string();
        let _ = writeln!(
            source,
            "    umbel_sdk::Asset {{ path: {relative:?}, bytes: include_bytes!({absolute:?}) }},"
        );
    }
    source.push_str("]\n");
    fs::write(out_dir.join("umbel_assets.rs"), source)
}

fn env_var(name: &str) -> io::Result<String> {
    std::env::var(name).map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("{name} is not set; call embed_assets from a build script"),
        )
    })
}

fn collect(dir: &Path, relative: &str, files: &mut Vec<(String, PathBuf)>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().into_string().map_err(|name| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{name:?} is not a UTF-8 file name"),
            )
        })?;
        let relative = format!("{relative}/{name}");
        let path = entry.path();
        if path.is_dir() {
            collect(&path, &relative, files)?;
        } else {
            files.push((relative, path));
        }
    }
    Ok(())
}
