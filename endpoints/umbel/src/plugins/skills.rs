//! The file-level rules of a skill directory (specification section 8.3, D47).
//!
//! A skill is an Agent Skills directory: a `SKILL.md` and optional supporting files, at most 512
//! files and 16 MiB. Step 3 adds the frontmatter rules and the three delivery paths; the name
//! rules are the manifest's.

use std::path::Path;

use super::error::PluginError;
use super::files::{DirFiles, PluginFiles};

/// At most this many files in one skill (the Skills extension's limit).
pub const MAX_SKILL_FILES: usize = 512;
/// At most this many bytes in one skill (the Skills extension's limit).
pub const MAX_SKILL_BYTES: u64 = 16 * 1024 * 1024;

/// What a valid skill directory holds.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct SkillReport {
    /// How many files it holds.
    pub files: usize,
    /// Their total size.
    pub bytes: u64,
}

/// Check the skill directory `dir`: it holds `SKILL.md`, no symlink leaves it, and it is within
/// the limits.
///
/// # Errors
/// `SKILL_INVALID` naming the skill's path.
pub fn check_skill(dir: &Path) -> Result<SkillReport, PluginError> {
    let label = dir.display().to_string();
    let files = DirFiles::new(dir)
        .map_err(|error| PluginError::skill_invalid(&label, format!("cannot be read: {error}")))?;
    if !files.is_file("SKILL.md") {
        return Err(PluginError::skill_invalid(&label, "has no SKILL.md"));
    }
    let (count, size) = files
        .tree(".")
        .map_err(|problem| PluginError::skill_invalid(&label, problem))?;
    if count > MAX_SKILL_FILES || size > MAX_SKILL_BYTES {
        return Err(PluginError::skill_invalid(
            &label,
            format!(
                "holds {count} files and {size} bytes; the limits are {MAX_SKILL_FILES} files and {MAX_SKILL_BYTES} bytes"
            ),
        ));
    }
    Ok(SkillReport {
        files: count,
        bytes: size,
    })
}
