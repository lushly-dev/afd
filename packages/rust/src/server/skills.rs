//! The Skills over MCP extension (`io.modelcontextprotocol/skills`, SEP-2640), served by
//! [`McpServer::with_skills`](super::McpServer::with_skills) (`spec/mcp-resources.md`, S1 to S8).
//!
//! A [`SkillCatalog`] is fixed when it is built: [`SkillCatalog::new`] reads each skill's bytes
//! once, checks every rule of S2 and computes the digests, so a catalog that exists is one the
//! server can serve. The server serves skills as data: it reads only the frontmatter, never
//! follows instructions in a skill and never widens anything for one.
//!
//! ```
//! # fn run() -> Result<(), String> {
//! use afd::server::{Skill, SkillCatalog};
//!
//! let catalog = SkillCatalog::new(vec![Skill::new("hello-greeting")
//!     .with_file(
//!         "SKILL.md",
//!         "---\nname: hello-greeting\ndescription: Greet a person by name.\n---\n\nCall hello-greet.\n",
//!     )
//!     .with_file("references/STYLE.md", "# Style\n")])?;
//! # let _ = catalog;
//! # Ok(())
//! # }
//! # run().unwrap();
//! ```

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use super::encoding::sha256_digest;

/// The most files one skill may have, the extension's limit.
pub const MAX_SKILL_FILES: usize = 512;

/// The most bytes one skill may have in total, `SKILL.md` included: 16 MiB.
pub const MAX_SKILL_BYTES: usize = 16 * 1024 * 1024;

/// The MIME type of a directory in a `resources/directory/read` result.
const DIRECTORY_MIME_TYPE: &str = "inode/directory";

/// One skill as the host gives it: a skill path and its files' bytes.
///
/// The skill path is `/`-separated: optional prefix segments, then the skill's `name`
/// (`hello-greeting`, `acme/lint-rules`). Files are addressed by their path relative to the
/// skill's root (`SKILL.md`, `references/STYLE.md`). Nothing is checked until
/// [`SkillCatalog::new`].
#[derive(Debug, Clone)]
pub struct Skill {
    path: String,
    files: Vec<(String, Vec<u8>)>,
}

impl Skill {
    /// A skill at `path` with no files yet.
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            files: Vec::new(),
        }
    }

    /// Add a file: its path relative to the skill's root and its bytes.
    pub fn with_file(mut self, path: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        self.files.push((path.into(), bytes.into()));
        self
    }

    /// Read a skill from a directory: every regular file under `dir`, at its relative path.
    ///
    /// A symbolic link is followed only to a regular file inside `dir`; one that leaves it, or
    /// that names a directory, is refused, as is anything that is neither a file nor a directory.
    /// A file whose name is not UTF-8 is refused. The limits of [`MAX_SKILL_FILES`] and
    /// [`MAX_SKILL_BYTES`] are checked before a file is read.
    ///
    /// # Errors
    /// A message naming the skill and the problem.
    pub fn from_dir(path: impl Into<String>, dir: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.into();
        let fail = |problem: String| format!("skill \"{path}\": {problem}");
        let dir = dir.as_ref();
        let root = std::fs::canonicalize(dir)
            .map_err(|error| fail(format!("cannot read {}: {error}", dir.display())))?;
        let mut skill = Self::new(path.clone());
        let mut total = 0usize;
        let mut pending: Vec<(PathBuf, String)> = vec![(root.clone(), String::new())];
        while let Some((directory, prefix)) = pending.pop() {
            let entries = std::fs::read_dir(&directory)
                .map_err(|error| fail(format!("cannot read {}: {error}", directory.display())))?;
            for entry in entries {
                let entry = entry.map_err(|error| fail(error.to_string()))?;
                let file_name = entry.file_name().into_string().map_err(|name| {
                    fail(format!(
                        "the file name {name:?} in {} is not UTF-8",
                        directory.display()
                    ))
                })?;
                let relative = format!("{prefix}{file_name}");
                let location = entry.path();
                let kind = entry.file_type().map_err(|error| fail(error.to_string()))?;
                let (source, kind) = if kind.is_symlink() {
                    let target = std::fs::canonicalize(&location)
                        .map_err(|error| fail(format!("cannot follow {relative}: {error}")))?;
                    if !target.starts_with(&root) {
                        return Err(fail(format!(
                            "{relative} is a symbolic link that leaves the skill's directory"
                        )));
                    }
                    let kind = std::fs::metadata(&target)
                        .map_err(|error| fail(error.to_string()))?
                        .file_type();
                    if kind.is_dir() {
                        return Err(fail(format!(
                            "{relative} is a symbolic link to a directory"
                        )));
                    }
                    (target, kind)
                } else {
                    (location, kind)
                };
                if kind.is_dir() {
                    pending.push((source, format!("{relative}/")));
                } else if kind.is_file() {
                    if skill.files.len() >= MAX_SKILL_FILES {
                        return Err(fail(format!("has more than {MAX_SKILL_FILES} files")));
                    }
                    let size = std::fs::metadata(&source)
                        .map_err(|error| fail(error.to_string()))?
                        .len();
                    total = total.saturating_add(usize::try_from(size).unwrap_or(usize::MAX));
                    if total > MAX_SKILL_BYTES {
                        return Err(fail(format!("has more than {MAX_SKILL_BYTES} bytes")));
                    }
                    let bytes = std::fs::read(&source)
                        .map_err(|error| fail(format!("cannot read {relative}: {error}")))?;
                    skill.files.push((relative, bytes));
                } else {
                    return Err(fail(format!("{relative} is not a regular file")));
                }
            }
        }
        Ok(skill)
    }
}

/// One file of a checked skill, with everything the server serves about it.
#[derive(Debug)]
pub(crate) struct CatalogFile {
    pub(crate) uri: String,
    /// The file's path relative to the skill's root.
    pub(crate) path: String,
    pub(crate) bytes: Arc<[u8]>,
    pub(crate) digest: String,
    pub(crate) mime_type: &'static str,
    /// The `resources/list` entry (S5).
    pub(crate) resource: Value,
}

#[derive(Debug)]
struct CatalogSkill {
    path: String,
    /// The `skills/list` entry (S3), also the `skills/get` answer.
    entry: Value,
    /// In manifest order: `SKILL.md`, then ascending by the path's UTF-8 bytes.
    files: Vec<CatalogFile>,
}

/// An ordered, checked set of skills, fixed when it is built (`spec/mcp-resources.md`, S2).
#[derive(Debug, Clone)]
pub struct SkillCatalog {
    skills: Arc<Vec<CatalogSkill>>,
    /// File URI to (skill, file).
    files: Arc<HashMap<String, (usize, usize)>>,
    /// Directory URI to the skill it belongs to and its path inside the skill (empty for the root).
    directories: Arc<HashMap<String, (usize, String)>>,
    directory_read: bool,
}

impl SkillCatalog {
    /// Check `skills` and build the catalog, in the given order.
    ///
    /// # Errors
    /// A message naming the skill and the rule: no `SKILL.md`; frontmatter that is not the
    /// documented YAML; a `name` or `description` that breaks the Agent Skills limits; a skill
    /// path whose last segment is not the `name`, or a name or path used twice; a file path that
    /// is not relative and `/`-separated or has an empty, `.` or `..` segment, or repeats; more
    /// than [`MAX_SKILL_FILES`] files or [`MAX_SKILL_BYTES`] bytes.
    pub fn new(skills: Vec<Skill>) -> Result<Self, String> {
        let mut built: Vec<CatalogSkill> = Vec::with_capacity(skills.len());
        let mut names: HashSet<String> = HashSet::new();
        let mut paths: HashSet<String> = HashSet::new();
        for skill in skills {
            let checked = check_skill(skill)?;
            if !paths.insert(checked.path.clone()) {
                return Err(format!(
                    "skill \"{}\": the skill path is used twice",
                    checked.path
                ));
            }
            let name = checked.entry["frontmatter"]["name"]
                .as_str()
                .unwrap_or_default();
            if !names.insert(name.to_owned()) {
                return Err(format!(
                    "skill \"{}\": the name \"{name}\" is used by another skill (names are unique in a catalog, even under different prefixes)",
                    checked.path
                ));
            }
            built.push(checked);
        }
        let mut files = HashMap::new();
        let mut directories: HashMap<String, (usize, String)> = HashMap::new();
        for (skill_index, skill) in built.iter().enumerate() {
            for (file_index, file) in skill.files.iter().enumerate() {
                if files
                    .insert(file.uri.clone(), (skill_index, file_index))
                    .is_some()
                {
                    return Err(format!(
                        "skill \"{}\": the URI {} is also served by another skill",
                        skill.path, file.uri
                    ));
                }
            }
            for directory in directories_of(skill) {
                let uri = if directory.is_empty() {
                    format!("skill://{}", skill.path)
                } else {
                    format!("skill://{}/{directory}", skill.path)
                };
                if directories
                    .insert(uri.clone(), (skill_index, directory))
                    .is_some()
                {
                    return Err(format!(
                        "skill \"{}\": the directory {uri} is also a directory of another skill",
                        skill.path
                    ));
                }
            }
        }
        if let Some(uri) = directories.keys().find(|uri| files.contains_key(*uri)) {
            return Err(format!("{uri} is both a skill file and a skill directory"));
        }
        Ok(Self {
            skills: Arc::new(built),
            files: Arc::new(files),
            directories: Arc::new(directories),
            directory_read: false,
        })
    }

    /// Serve `resources/directory/read` for every directory of every skill, and declare
    /// `directoryRead: true` (S6). Off by default.
    #[must_use]
    pub fn with_directory_read(mut self, enabled: bool) -> Self {
        self.directory_read = enabled;
        self
    }

    /// Whether directory reads are on.
    pub fn directory_read(&self) -> bool {
        self.directory_read
    }

    /// The number of skills.
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// Whether the catalog has no skills.
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// The `skills/list` entries, in catalog order: each skill's `uri`, its `frontmatter` and the
    /// `resources` manifest of every file with its `digest` and `size` (S3). A host that lists
    /// its skills outside MCP (a CLI, a report) reads what the server serves instead of parsing
    /// `SKILL.md` a second time.
    pub fn entries(&self) -> Vec<Value> {
        self.skills
            .iter()
            .map(|skill| skill.entry.clone())
            .collect()
    }

    /// The `skills/get` answer for `uri`: the entry whose `uri` it equals exactly.
    pub(crate) fn entry(&self, uri: &str) -> Option<&Value> {
        self.skills
            .iter()
            .map(|skill| &skill.entry)
            .find(|entry| entry["uri"] == uri)
    }

    /// The skill files as `resources/list` entries: skill by skill in catalog order, each in its
    /// manifest order (S5).
    pub(crate) fn resources(&self) -> impl Iterator<Item = &Value> {
        self.skills
            .iter()
            .flat_map(|skill| skill.files.iter().map(|file| &file.resource))
    }

    /// A skill file by its exact URI.
    pub(crate) fn file(&self, uri: &str) -> Option<&CatalogFile> {
        let (skill, file) = self.files.get(uri)?;
        Some(&self.skills[*skill].files[*file])
    }

    /// The direct children of a skill directory, by exact URI (S6), or `None` when `uri` is not
    /// the root or a subdirectory holding a file of a skill.
    pub(crate) fn directory(&self, uri: &str) -> Option<Vec<Value>> {
        let (skill, directory) = self.directories.get(uri)?;
        let skill = &self.skills[*skill];
        let prefix = if directory.is_empty() {
            String::new()
        } else {
            format!("{directory}/")
        };
        let mut children: BTreeMap<&str, Value> = BTreeMap::new();
        for file in &skill.files {
            let Some(rest) = file.path.strip_prefix(&prefix) else {
                continue;
            };
            match rest.split_once('/') {
                None => {
                    children.insert(rest, file.resource.clone());
                }
                Some((subdirectory, _)) => {
                    children.entry(subdirectory).or_insert_with(|| {
                        json!({
                            "uri": format!("{uri}/{subdirectory}"),
                            "name": subdirectory,
                            "mimeType": DIRECTORY_MIME_TYPE,
                        })
                    });
                }
            }
        }
        // `BTreeMap<&str, _>` orders by the names' UTF-8 bytes.
        Some(children.into_values().collect())
    }
}

/// Every directory of `skill` that holds a file, as a path inside the skill: the root (empty)
/// and each subdirectory on the way to a file.
fn directories_of(skill: &CatalogSkill) -> HashSet<String> {
    let mut directories = HashSet::from([String::new()]);
    for file in &skill.files {
        let mut end = 0;
        while let Some(slash) = file.path[end..].find('/') {
            end += slash;
            directories.insert(file.path[..end].to_owned());
            end += 1;
        }
    }
    directories
}

/// Whether `text` follows the Agent Skills character rule for a name: 1 to 64 characters of
/// `a-z`, `0-9` and `-`, not starting or ending with `-`, with no `--`.
fn is_name(text: &str) -> bool {
    (1..=64).contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !text.starts_with('-')
        && !text.ends_with('-')
        && !text.contains("--")
}

fn check_skill(skill: Skill) -> Result<CatalogSkill, String> {
    let Skill { path, files } = skill;
    let fail = |rule: &str| format!("skill \"{path}\": {rule}");
    let segments: Vec<&str> = path.split('/').collect();
    let Some(last) = segments.last().copied() else {
        return Err(fail("the skill path is empty"));
    };
    if let Some(bad) = segments.iter().find(|segment| !is_name(segment)) {
        return Err(fail(&format!(
            "the skill path segment \"{bad}\" must be 1 to 64 characters of a-z, 0-9 and -, not starting or ending with -, with no --"
        )));
    }
    if files.len() > MAX_SKILL_FILES {
        return Err(fail(&format!("has more than {MAX_SKILL_FILES} files")));
    }
    let total: usize = files.iter().map(|(_, bytes)| bytes.len()).sum();
    if total > MAX_SKILL_BYTES {
        return Err(fail(&format!("has more than {MAX_SKILL_BYTES} bytes")));
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for (file, _) in &files {
        if file.is_empty()
            || file
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return Err(fail(&format!(
                "the file path \"{file}\" must be relative and \"/\"-separated, with no empty, \".\" or \"..\" segment"
            )));
        }
        if !seen.insert(file) {
            return Err(fail(&format!("the file path \"{file}\" is repeated")));
        }
    }
    let Some((_, skill_md)) = files.iter().find(|(file, _)| file == "SKILL.md") else {
        return Err(fail("has no SKILL.md at its root"));
    };
    let text = std::str::from_utf8(skill_md).map_err(|_| fail("SKILL.md is not valid UTF-8"))?;
    let frontmatter = match crate::frontmatter::parse(text) {
        Ok(Some(found)) => found.fields,
        Ok(None) => return Err(fail("SKILL.md must begin with a line ---")),
        Err(problem) => return Err(fail(&format!("SKILL.md: {problem}"))),
    };
    let Some(name) = frontmatter.get("name").and_then(Value::as_str) else {
        return Err(fail("the frontmatter needs a string \"name\""));
    };
    if !is_name(name) {
        return Err(fail(&format!(
            "the name \"{name}\" must be 1 to 64 characters of a-z, 0-9 and -, not starting or ending with -, with no --"
        )));
    }
    if name != last {
        return Err(fail(&format!(
            "the name \"{name}\" must equal the last segment of the skill path, \"{last}\""
        )));
    }
    let description = frontmatter.get("description").and_then(Value::as_str);
    match description {
        Some(text) if !text.is_empty() && text.chars().count() <= 1024 => {}
        _ => {
            return Err(fail(
                "the frontmatter needs a \"description\" of 1 to 1,024 characters",
            ))
        }
    }
    let description = description.unwrap_or_default().to_owned();
    let name = name.to_owned();

    let mut files: Vec<(String, Vec<u8>)> = files;
    files.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));
    // `SKILL.md` first, then the others in ascending order of their paths' UTF-8 bytes.
    if let Some(position) = files.iter().position(|(file, _)| file == "SKILL.md") {
        let skill_md = files.remove(position);
        files.insert(0, skill_md);
    }
    let prefix = format!("skill://{path}/");
    let files: Vec<CatalogFile> = files
        .into_iter()
        .map(|(file, bytes)| {
            let digest = sha256_digest(&bytes);
            let mime_type = mime_type_of(&file);
            let mut resource = json!({
                "uri": format!("{prefix}{file}"),
                "name": if file == "SKILL.md" { name.clone() } else { file.clone() },
                "mimeType": mime_type,
                "size": bytes.len(),
                "_meta": { "dev.afd/digest": digest },
            });
            if file == "SKILL.md" {
                resource["description"] = json!(description);
            }
            CatalogFile {
                uri: format!("{prefix}{file}"),
                path: file,
                bytes: bytes.into(),
                digest,
                mime_type,
                resource,
            }
        })
        .collect();
    let manifest: Vec<Value> = files
        .iter()
        .map(|file| json!({ "uri": file.uri, "digest": file.digest, "size": file.bytes.len() }))
        .collect();
    let entry = json!({
        "uri": format!("{prefix}SKILL.md"),
        "frontmatter": Value::Object(frontmatter),
        "resources": manifest,
    });
    Ok(CatalogSkill { path, entry, files })
}

/// The MIME type of a skill file by its suffix, compared case-insensitively (S5).
pub(crate) fn mime_type_of(path: &str) -> &'static str {
    let file = path.rsplit('/').next().unwrap_or(path);
    let Some((_, suffix)) = file.rsplit_once('.') else {
        return "application/octet-stream";
    };
    match suffix.to_ascii_lowercase().as_str() {
        "md" => "text/markdown",
        "txt" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "csv" => "text/csv",
        "html" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "ts" => "text/x-typescript",
        "py" => "text/x-python",
        "sh" => "text/x-shellscript",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill_md(name: &str) -> String {
        format!("---\nname: {name}\ndescription: Does {name}.\n---\n\nBody.\n")
    }

    fn catalog(skills: Vec<Skill>) -> Result<SkillCatalog, String> {
        SkillCatalog::new(skills)
    }

    #[test]
    fn mime_types_follow_the_suffix_table() {
        for (path, expected) in [
            ("SKILL.md", "text/markdown"),
            ("a/B.MD", "text/markdown"),
            ("a.txt", "text/plain"),
            ("a.json", "application/json"),
            ("a.yaml", "application/yaml"),
            ("a.YML", "application/yaml"),
            ("a.toml", "application/toml"),
            ("a.csv", "text/csv"),
            ("a.html", "text/html"),
            ("a.css", "text/css"),
            ("a.js", "text/javascript"),
            ("a.mjs", "text/javascript"),
            ("a.ts", "text/x-typescript"),
            ("a.py", "text/x-python"),
            ("a.sh", "text/x-shellscript"),
            ("a.svg", "image/svg+xml"),
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.JPEG", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.pdf", "application/pdf"),
            ("a.bin", "application/octet-stream"),
            ("noext", "application/octet-stream"),
            ("dir.md/file", "application/octet-stream"),
            (".md", "text/markdown"),
        ] {
            assert_eq!(mime_type_of(path), expected, "{path}");
        }
    }

    #[test]
    fn checks_the_limits_and_paths() {
        let md = skill_md("a");
        let too_many = (0..=MAX_SKILL_FILES).fold(
            Skill::new("a").with_file("SKILL.md", md.clone()),
            |skill, index| skill.with_file(format!("f{index}.txt"), "x"),
        );
        assert!(catalog(vec![too_many]).unwrap_err().contains("files"));
        let too_big = Skill::new("a")
            .with_file("SKILL.md", md.clone())
            .with_file("big.bin", vec![0u8; MAX_SKILL_BYTES]);
        assert!(catalog(vec![too_big]).unwrap_err().contains("bytes"));
        for bad in ["", "/a", "a/", "a//b", "./a", "a/./b", "a/../b", "../a"] {
            let skill = Skill::new("a")
                .with_file("SKILL.md", md.clone())
                .with_file(bad, "x");
            assert!(catalog(vec![skill]).is_err(), "{bad:?}");
        }
        let repeated = Skill::new("a")
            .with_file("SKILL.md", md.clone())
            .with_file("x.txt", "1")
            .with_file("x.txt", "2");
        assert!(catalog(vec![repeated]).unwrap_err().contains("repeated"));
        let file_and_directory = Skill::new("a")
            .with_file("SKILL.md", md.clone())
            .with_file("x", "1")
            .with_file("x/y", "2");
        assert!(catalog(vec![file_and_directory]).is_err());
    }

    #[test]
    fn checks_names_paths_and_descriptions() {
        let one =
            |path: &str, text: &str| catalog(vec![Skill::new(path).with_file("SKILL.md", text)]);
        let long_name = "a".repeat(65);
        assert!(one(&long_name, &skill_md(&long_name)).is_err());
        let longest = "a".repeat(64);
        assert!(one(&longest, &skill_md(&longest)).is_ok());
        for bad in ["-a", "a-", "A", "a_b", "a b"] {
            assert!(one(bad, &skill_md(bad)).is_err(), "{bad}");
        }
        assert!(one("Acme/a", &skill_md("a")).is_err());
        assert!(one("a", "---\nname: a\ndescription: \"\"\n---\n").is_err());
        assert!(one(
            "a",
            &format!("---\nname: a\ndescription: {}\n---\n", "é".repeat(1025))
        )
        .is_err());
        assert!(one(
            "a",
            &format!("---\nname: a\ndescription: {}\n---\n", "é".repeat(1024))
        )
        .is_ok());
        assert!(one("a", "---\nname: 7\ndescription: x\n---\n").is_err());
        let not_utf8 = Skill::new("a").with_file("SKILL.md", vec![0xff, 0xfe]);
        assert!(catalog(vec![not_utf8]).unwrap_err().contains("UTF-8"));
        let same_path = vec![
            Skill::new("a").with_file("SKILL.md", skill_md("a")),
            Skill::new("a").with_file("SKILL.md", skill_md("a")),
        ];
        assert!(catalog(same_path).is_err());
    }

    #[test]
    fn manifest_and_listing_orders() {
        let catalog = catalog(vec![
            Skill::new("p/b")
                .with_file("z.md", "z")
                .with_file("A.md", "a")
                .with_file("SKILL.md", skill_md("b"))
                .with_file("m/n.txt", "n"),
            Skill::new("a").with_file("SKILL.md", skill_md("a")),
        ])
        .unwrap();
        let listed: Vec<String> = catalog
            .entries()
            .iter()
            .map(|entry| entry["uri"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(listed, ["skill://p/b/SKILL.md", "skill://a/SKILL.md"]);
        let manifest: Vec<String> = catalog.entries()[0]["resources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["uri"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            manifest,
            [
                "skill://p/b/SKILL.md",
                "skill://p/b/A.md",
                "skill://p/b/m/n.txt",
                "skill://p/b/z.md",
            ]
        );
        assert_eq!(catalog.resources().count(), 5);
    }

    #[test]
    fn directories_list_children_in_byte_order() {
        let catalog = catalog(vec![Skill::new("b")
            .with_file("SKILL.md", skill_md("b"))
            .with_file("references/one.md", "1")
            .with_file("references/deep/two.md", "2")
            .with_file("assets/x.bin", "x")
            .with_file("z.txt", "z")])
        .unwrap();
        let names = |uri: &str| -> Option<Vec<String>> {
            catalog.directory(uri).map(|children| {
                children
                    .iter()
                    .map(|child| child["uri"].as_str().unwrap().to_owned())
                    .collect()
            })
        };
        assert_eq!(
            names("skill://b").unwrap(),
            [
                "skill://b/SKILL.md",
                "skill://b/assets",
                "skill://b/references",
                "skill://b/z.txt",
            ]
        );
        assert_eq!(
            names("skill://b/references").unwrap(),
            ["skill://b/references/deep", "skill://b/references/one.md"]
        );
        let root = catalog.directory("skill://b").unwrap();
        assert_eq!(root[1]["mimeType"], "inode/directory");
        assert_eq!(root[1]["name"], "assets");
        assert!(names("skill://b/").is_none());
        assert!(names("skill://b/missing").is_none());
        assert!(names("skill://b/z.txt").is_none());
        assert!(names("skill://c").is_none());
    }

    #[test]
    fn reads_a_directory_and_refuses_links_that_leave_it() {
        let temp = std::env::temp_dir().join(format!("afd-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        let skill = temp.join("hello");
        std::fs::create_dir_all(skill.join("references")).unwrap();
        std::fs::write(skill.join("SKILL.md"), skill_md("hello")).unwrap();
        std::fs::write(skill.join("references/STYLE.md"), "# Style\n").unwrap();
        std::fs::write(temp.join("outside.md"), "secret").unwrap();
        let loaded = Skill::from_dir("hello", &skill).unwrap();
        let catalog = SkillCatalog::new(vec![loaded]).unwrap();
        assert_eq!(catalog.resources().count(), 2);
        assert_eq!(
            catalog
                .file("skill://hello/references/STYLE.md")
                .unwrap()
                .bytes
                .as_ref(),
            b"# Style\n"
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("SKILL.md", skill.join("alias.md")).unwrap();
            let inside = Skill::from_dir("hello", &skill).unwrap();
            assert_eq!(inside.files.len(), 3);
            std::os::unix::fs::symlink(temp.join("outside.md"), skill.join("leak.md")).unwrap();
            let error = Skill::from_dir("hello", &skill).unwrap_err();
            assert!(
                error.contains("leak.md") && error.contains("leaves"),
                "{error}"
            );
            std::fs::remove_file(skill.join("leak.md")).unwrap();
            std::os::unix::fs::symlink(&temp, skill.join("up")).unwrap();
            assert!(Skill::from_dir("hello", &skill).is_err());
        }
        assert!(Skill::from_dir("hello", temp.join("missing")).is_err());
        let _ = std::fs::remove_dir_all(&temp);
    }
}
