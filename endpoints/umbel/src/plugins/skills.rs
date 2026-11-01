//! Skills (specification section 8.3, D47).
//!
//! A skill is an Agent Skills directory: a `SKILL.md` and optional supporting files, at most 512
//! files and 16 MiB. The file rules and the frontmatter rules are one check: the skill is read
//! through the files of its plugin and handed to AFD's [`SkillCatalog`], which refuses what the
//! Skills extension refuses, so a skill that loads is one the host's server can serve. The name
//! rule (the plugin id first) is the manifest's. A skill is untrusted content: the host serves
//! its bytes and never reads instructions from them.

use std::path::Path;

use afd::server::{Skill, SkillCatalog};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::error::PluginError;
use super::files::{DirFiles, PluginFiles};

/// At most this many files in one skill (the Skills extension's limit).
pub const MAX_SKILL_FILES: usize = 512;
/// At most this many bytes in one skill (the Skills extension's limit).
pub const MAX_SKILL_BYTES: u64 = 16 * 1024 * 1024;

/// The file `skill-export` writes beside a skill's files; a skill cannot ship one of its own.
pub(crate) const ORIGIN_FILE: &str = ".umbel-origin.json";

/// What a valid skill directory holds.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct SkillReport {
    /// How many files it holds.
    pub files: usize,
    /// Their total size.
    pub bytes: u64,
}

/// One file of a loaded skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkillFile {
    /// The path relative to the skill's root, with `/` separators.
    pub path: String,
    pub bytes: Vec<u8>,
    /// `sha256:<hex>` of the bytes: AFD's digest, the Skills extension's format.
    pub digest: String,
}

/// A skill read from its plugin, validated, with its place in the deployment.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LoadedSkill {
    pub name: String,
    /// The instance that ships it.
    pub instance: String,
    /// The plugin id and version of that instance.
    pub plugin: String,
    pub version: String,
    /// `SKILL.md` first, then the others in byte order of their paths.
    pub files: Vec<SkillFile>,
    /// The `skills/list` entry AFD serves for it: `uri`, `frontmatter` and the file manifest.
    pub entry: Value,
}

impl LoadedSkill {
    /// The skill in the shape AFD's catalog takes.
    pub(crate) fn to_skill(&self) -> Skill {
        self.files
            .iter()
            .fold(Skill::new(self.name.clone()), |skill, file| {
                skill.with_file(file.path.clone(), file.bytes.clone())
            })
    }

    pub(crate) fn uri(&self) -> String {
        self.entry["uri"].as_str().unwrap_or_default().to_owned()
    }

    pub(crate) fn description(&self) -> String {
        self.entry["frontmatter"]["description"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    /// The digest of `SKILL.md`.
    pub(crate) fn digest(&self) -> String {
        self.files
            .first()
            .map(|file| file.digest.clone())
            .unwrap_or_default()
    }

    /// The same bytes under the same paths.
    pub(crate) fn same_content(&self, other: &Self) -> bool {
        self.files == other.files
    }
}

/// `sha256:` and the lowercase hex of `bytes`.
pub(crate) fn digest(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    let mut text = String::from("sha256:");
    for byte in hash {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// Read and check the skill `name` at `path` (a directory of `files`, relative to the plugin
/// root): the limits before any byte is read, then every rule of AFD's catalog.
///
/// # Errors
/// The rule the skill breaks, as a clause to follow "the skill".
pub(crate) fn read_skill(
    files: &dyn PluginFiles,
    name: &str,
    path: &str,
) -> Result<(Vec<SkillFile>, Value), String> {
    let unreadable = |problem: String| format!("cannot be read: {problem}");
    let listed = files.list(path).map_err(unreadable)?;
    if listed.len() > MAX_SKILL_FILES {
        return Err(format!(
            "holds {} files; the limit is {MAX_SKILL_FILES}",
            listed.len()
        ));
    }
    if !listed.iter().any(|file| file == "SKILL.md") {
        return Err("has no SKILL.md".to_owned());
    }
    if listed.iter().any(|file| file == ORIGIN_FILE) {
        return Err(format!(
            "ships a file named {ORIGIN_FILE}, which `skill-export` writes itself"
        ));
    }
    let base = path.trim_end_matches('/');
    let mut total = 0u64;
    for file in &listed {
        total += files.len(&format!("{base}/{file}")).map_err(unreadable)?;
        if total > MAX_SKILL_BYTES {
            return Err(format!("holds more than {MAX_SKILL_BYTES} bytes"));
        }
    }
    let mut skill = Skill::new(name);
    let mut loaded = Vec::with_capacity(listed.len());
    for file in &listed {
        let bytes = files.read(&format!("{base}/{file}")).map_err(unreadable)?;
        skill = skill.with_file(file.clone(), bytes.clone());
        loaded.push(SkillFile {
            path: file.clone(),
            digest: digest(&bytes),
            bytes,
        });
    }
    // `SKILL.md` first, then the others in byte order: the order AFD lists them in.
    loaded.sort_by(|left, right| {
        (left.path != "SKILL.md")
            .cmp(&(right.path != "SKILL.md"))
            .then_with(|| left.path.as_bytes().cmp(right.path.as_bytes()))
    });
    let catalog = SkillCatalog::new(vec![skill]).map_err(|problem| {
        let prefix = format!("skill \"{name}\": ");
        problem.strip_prefix(&prefix).unwrap_or(&problem).to_owned()
    })?;
    let entry = catalog
        .entries()
        .into_iter()
        .next()
        .ok_or_else(|| "is not listed by the Skills extension's catalog".to_owned())?;
    Ok((loaded, entry))
}

/// Check the skill directory `dir`: it holds `SKILL.md` with valid frontmatter whose name is the
/// directory's name, no symlink leaves it, and it is within the limits.
///
/// # Errors
/// `SKILL_INVALID` naming the skill's path.
pub fn check_skill(dir: &Path) -> Result<SkillReport, PluginError> {
    let label = dir.display().to_string();
    let files = DirFiles::new(dir)
        .map_err(|error| PluginError::skill_invalid(&label, format!("cannot be read: {error}")))?;
    let name = files
        .root()
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    let (loaded, _) = read_skill(&files, &name, ".")
        .map_err(|problem| PluginError::skill_invalid(&label, problem))?;
    Ok(SkillReport {
        files: loaded.len(),
        bytes: loaded.iter().map(|file| file.bytes.len() as u64).sum(),
    })
}

/// The origin file `skill-export` writes beside a skill: where the copy came from, so a harness
/// skill directory knows its source. Deterministic, so a second export of an unchanged skill
/// changes nothing.
pub(crate) fn origin_file(skill: &LoadedSkill) -> Vec<u8> {
    let files: Vec<Value> = skill
        .files
        .iter()
        .map(|file| json!({ "path": file.path, "digest": file.digest, "size": file.bytes.len() }))
        .collect();
    let document = json!({
        "umbel_origin": 1,
        "skill": skill.name,
        "uri": skill.uri(),
        "instance": skill.instance,
        "plugin": skill.plugin,
        "version": skill.version,
        "files": files,
    });
    let mut text = serde_json::to_string_pretty(&document).unwrap_or_default();
    text.push('\n');
    text.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::digest;

    #[test]
    fn digests_are_afds_format() {
        assert_eq!(
            digest(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
