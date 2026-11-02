//! A collection as the sync sees it: its settings from the workspace, with the include and
//! exclude patterns compiled, and the files its root holds that the patterns select.

use globset::{Glob, GlobSet, GlobSetBuilder};
use umbel_okf::Kind;
use umbel_sdk::{CollectionInfo, ContentEntry, Cx, HostError};
use umbel_store::{ContentHash, Sensitivity};

/// The most files one collection may hold (section 5.2).
pub(crate) const MAX_FILES: usize = 100_000;
/// The entries one `content_list` page holds.
const PAGE: u32 = 1000;

/// A collection with its patterns compiled.
pub(crate) struct Collection {
    pub(crate) info: CollectionInfo,
    pub(crate) kind: Kind,
    pub(crate) sensitivity: Sensitivity,
    include: GlobSet,
    exclude: GlobSet,
}

fn compile(patterns: &[String]) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|error| format!("`{pattern}`: {error}"))?);
    }
    builder.build().map_err(|error| error.to_string())
}

impl Collection {
    /// Compile a collection's settings.
    ///
    /// # Errors
    /// What is wrong with a pattern or the sensitivity.
    pub(crate) fn new(info: CollectionInfo) -> Result<Self, String> {
        let sensitivity = serde_json::from_value(serde_json::Value::String(
            info.sensitivity.clone(),
        ))
        .map_err(|_| {
            format!(
                "the sensitivity `{}` is not one of public, internal, confidential, restricted",
                info.sensitivity
            )
        })?;
        Ok(Self {
            kind: if info.kind == "code" {
                Kind::Code
            } else {
                Kind::Markdown
            },
            sensitivity,
            include: compile(&info.include)?,
            exclude: compile(&info.exclude)?,
            info,
        })
    }

    /// Whether `path` (relative to the root) is one of the collection's files.
    pub(crate) fn selects(&self, path: &str) -> bool {
        self.include.is_match(path) && !self.exclude.is_match(path)
    }

    /// A digest of everything that decides how a file becomes a document, so a change to a
    /// setting makes the next sync read every file again.
    pub(crate) fn digest(&self, schema: &[u8]) -> String {
        let text = format!(
            "state=1\nkind={}\ninclude={:?}\nexclude={:?}\ndefault_type={}\nstrict={}\nmax={}\nschema={}",
            self.info.kind,
            self.info.include,
            self.info.exclude,
            self.info.default_type,
            self.info.strict,
            self.info.max_file_bytes,
            ContentHash::of(schema),
        );
        short(&ContentHash::of(text.as_bytes()).to_string())
    }
}

/// The first 16 hex digits of a `sha256:<hex>` hash.
pub(crate) fn short(hash: &str) -> String {
    hash.strip_prefix("sha256:")
        .unwrap_or(hash)
        .chars()
        .take(16)
        .collect()
}

/// Every file of the collection's root in path order (the host sorts them), selected or not, or
/// `None` when it holds more than [`MAX_FILES`].
pub(crate) fn list(
    cx: &Cx,
    space: &str,
    collection: &str,
) -> Result<Option<Vec<ContentEntry>>, HostError> {
    let mut all = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let page = cx.content_list(space, collection, after.as_deref(), PAGE)?;
        all.extend(page.items);
        // Candidates are bounded, not every file: a root may hold other files in any number, but
        // only the selected ones count; the caller checks that bound. A root with an unbounded
        // number of files is refused outright.
        if all.len() > MAX_FILES * 4 {
            return Ok(None);
        }
        match page.next {
            Some(next) => after = Some(next),
            None => return Ok(Some(all)),
        }
    }
}
