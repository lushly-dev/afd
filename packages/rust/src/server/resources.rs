//! MCP resources and the Skills extension's methods (`spec/mcp-resources.md`).
//!
//! [`McpServer::with_resources`](super::McpServer::with_resources) serves a
//! [`ResourceProvider`]'s entries; [`McpServer::with_skills`](super::McpServer::with_skills)
//! serves a [`SkillCatalog`](super::SkillCatalog) through `skills/list`, `skills/get` and the
//! skill files as resources. A server given either declares the `resources` capability (never
//! `subscribe` or `listChanged`: AFD servers push nothing), and one given a catalog also declares
//! `io.modelcontextprotocol/skills`.
//!
//! A read runs no command, middleware, confirmation, approval or journal entry, and the context
//! hook does not run for it; failures are JSON-RPC errors, never `CommandResult`s. An unknown URI
//! is `-32602` with `data.uri` on both MCP eras.

use std::sync::Arc;

use async_trait::async_trait;
use rmcp::model::{
    CustomRequest, CustomResult, ListResourceTemplatesResult, ListResourcesResult,
    PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer};
use serde_json::{json, Map, Value};

use super::encoding::{base64, sha256_digest};
use super::{confirmations, internal, panic_guard, McpServer};
use crate::meta_keys::check_meta_entry;

/// The `_meta` key a resource's digest goes under, set by the server (R6).
pub const DIGEST_META_KEY: &str = "dev.afd/digest";

/// The MIME type MCP Apps requires of a `ui://` resource.
pub const MCP_APP_MIME_TYPE: &str = "text/html;profile=mcp-app";

const SKILLS_LIST: &str = "skills/list";
const SKILLS_GET: &str = "skills/get";
const DIRECTORY_READ: &str = "resources/directory/read";

/// One item of `resources/list` (`spec/mcp-resources.md`, R2).
///
/// A provider hands the server its entries; the server checks them when it starts serving
/// ([`McpServer::validate`]) and each time it lists them, and refuses the whole list with
/// `-32603` when one breaks a rule.
#[derive(Debug, Clone)]
pub struct ResourceEntry {
    uri: String,
    name: String,
    title: Option<String>,
    description: Option<String>,
    icons: Option<Value>,
    annotations: Option<Value>,
    mime_type: Option<String>,
    size: Option<u64>,
    meta: Map<String, Value>,
    content: Option<ResourceBytes>,
}

#[derive(Debug, Clone)]
struct ResourceBytes {
    bytes: Arc<[u8]>,
    digest: String,
}

impl ResourceEntry {
    /// An entry with the two required fields: an absolute `uri` with a scheme, unique in the
    /// server, and a non-empty `name`.
    pub fn new(uri: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            uri: uri.into(),
            name: name.into(),
            title: None,
            description: None,
            icons: None,
            annotations: None,
            mime_type: None,
            size: None,
            meta: Map::new(),
            content: None,
        }
    }

    /// The entry's `title`.
    #[must_use]
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// The entry's `description`.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// The entry's `icons`, passed through as MCP defines them.
    #[must_use]
    pub fn with_icons(mut self, icons: Value) -> Self {
        self.icons = Some(icons);
        self
    }

    /// The entry's `annotations`, passed through as MCP defines them.
    #[must_use]
    pub fn with_annotations(mut self, annotations: Value) -> Self {
        self.annotations = Some(annotations);
        self
    }

    /// The entry's `mimeType`. A `ui://` entry must use [`MCP_APP_MIME_TYPE`].
    #[must_use]
    pub fn with_mime_type(mut self, mime_type: impl Into<String>) -> Self {
        self.mime_type = Some(mime_type.into());
        self
    }

    /// The entry's `size`: the byte length of what a read returns. Set it when the provider
    /// knows it; [`Self::with_bytes`] sets it for you.
    #[must_use]
    pub fn with_size(mut self, size: u64) -> Self {
        self.size = Some(size);
        self
    }

    /// Add an extra `_meta` entry under the key rule (`spec/mcp-resources.md`, T2), where `ui` is
    /// not allowed on a resource entry. `dev.afd/digest` is the server's.
    #[must_use]
    pub fn with_meta(mut self, key: impl Into<String>, value: Value) -> Self {
        self.meta.insert(key.into(), value);
        self
    }

    /// Give the content's bytes up front. The server then serves them itself, sets `size` to
    /// their length and adds their digest under `_meta["dev.afd/digest"]`, so the provider's
    /// [`ResourceProvider::read`] is not called for this entry.
    #[must_use]
    pub fn with_bytes(mut self, bytes: impl Into<Vec<u8>>) -> Self {
        let bytes: Arc<[u8]> = bytes.into().into();
        self.size = Some(bytes.len() as u64);
        let digest = sha256_digest(&bytes);
        self.content = Some(ResourceBytes { bytes, digest });
        self
    }

    /// [`Self::with_bytes`] for text.
    #[must_use]
    pub fn with_text(self, text: impl Into<String>) -> Self {
        self.with_bytes(text.into().into_bytes())
    }

    /// The entry's `uri`.
    pub fn uri(&self) -> &str {
        &self.uri
    }

    /// The `resources/list` item, `_meta` included.
    fn to_json(&self) -> Value {
        let mut item = Map::new();
        item.insert("uri".into(), json!(self.uri));
        item.insert("name".into(), json!(self.name));
        for (key, value) in [
            ("title", self.title.as_ref().map(|value| json!(value))),
            (
                "description",
                self.description.as_ref().map(|value| json!(value)),
            ),
            ("icons", self.icons.clone()),
            ("annotations", self.annotations.clone()),
            (
                "mimeType",
                self.mime_type.as_ref().map(|value| json!(value)),
            ),
            ("size", self.size.map(|value| json!(value))),
        ] {
            if let Some(value) = value {
                item.insert(key.into(), value);
            }
        }
        let mut meta = self.meta.clone();
        if let Some(content) = &self.content {
            meta.insert(DIGEST_META_KEY.into(), json!(content.digest));
        }
        if !meta.is_empty() {
            item.insert("_meta".into(), Value::Object(meta));
        }
        Value::Object(item)
    }
}

/// What [`ResourceProvider::read`] returns: the bytes of one resource.
///
/// The server sends them as `text` when they are valid UTF-8 and as `blob` (standard base64)
/// otherwise.
#[derive(Debug, Clone, Default)]
pub struct ResourceContents {
    bytes: Vec<u8>,
    mime_type: Option<String>,
    meta: Map<String, Value>,
}

impl ResourceContents {
    /// The content's bytes.
    pub fn new(bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            bytes: bytes.into(),
            ..Self::default()
        }
    }

    /// Text content.
    pub fn text(text: impl Into<String>) -> Self {
        Self::new(text.into().into_bytes())
    }

    /// The `mimeType` of the item, used only when the resource has no listed entry (the entry's
    /// is used otherwise).
    #[must_use]
    pub fn with_mime_type(mut self, mime_type: impl Into<String>) -> Self {
        self.mime_type = Some(mime_type.into());
        self
    }

    /// Add `_meta` to the content item under the key rule, where `ui` is allowed so an MCP Apps
    /// view can carry its `_meta.ui` (`csp`, `permissions`, `domain`, `prefersBorder`).
    #[must_use]
    pub fn with_meta(mut self, key: impl Into<String>, value: Value) -> Self {
        self.meta.insert(key.into(), value);
        self
    }
}

/// Why [`ResourceProvider::read`] gave no content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceReadError {
    /// The provider serves no resource at that URI: `-32602` with `data.uri`.
    NotFound,
    /// The provider failed: `-32603`, with a generic message (the detail stays with the host).
    Failed(String),
}

/// What a server is given to serve resources (`spec/mcp-resources.md`, "Terms").
///
/// [`Self::list`] is called each time the server lists, so a provider may change its entries
/// while the server runs; the list MUST NOT vary by caller, connection or context, and an AFD
/// provider is given no request input. An entry with its bytes up front
/// ([`ResourceEntry::with_bytes`]) is served by the server; any other is read through
/// [`Self::read`]. A `Vec<ResourceEntry>` is a provider of such static entries.
#[async_trait]
pub trait ResourceProvider: Send + Sync {
    /// The entries, in the order `resources/list` returns them.
    fn list(&self) -> Vec<ResourceEntry>;

    /// The content at `uri`. A server MAY serve a URI it does not list, so this is called for
    /// every URI that is not a skill file and not an entry with its bytes up front. Default:
    /// [`ResourceReadError::NotFound`].
    async fn read(&self, uri: &str) -> Result<ResourceContents, ResourceReadError> {
        let _ = uri;
        Err(ResourceReadError::NotFound)
    }
}

#[async_trait]
impl ResourceProvider for Vec<ResourceEntry> {
    fn list(&self) -> Vec<ResourceEntry> {
        self.clone()
    }
}

/// The scheme of an absolute URI, when `uri` has one that RFC 3986 allows.
fn scheme_of(uri: &str) -> Option<&str> {
    let (scheme, rest) = uri.split_once(':')?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    (valid && !rest.chars().any(|c| c.is_control() || c.is_whitespace())).then_some(scheme)
}

/// Check a provider's entries against R2.
///
/// # Errors
/// A message naming the entry.
pub(super) fn check_entries(entries: &[ResourceEntry]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let fail = |rule: &str| format!("resource \"{}\": {rule}", entry.uri);
        let Some(scheme) = scheme_of(&entry.uri) else {
            return Err(fail("the uri must be an absolute URI with a scheme"));
        };
        if !seen.insert(entry.uri.as_str()) {
            return Err(fail("the uri is used by another entry"));
        }
        if entry.name.is_empty() {
            return Err(fail("the name must not be empty"));
        }
        if scheme.eq_ignore_ascii_case("skill") {
            return Err(fail(
                "the skill:// scheme belongs to the skill catalog (McpServer::with_skills)",
            ));
        }
        if scheme.eq_ignore_ascii_case("ui")
            && entry.mime_type.as_deref() != Some(MCP_APP_MIME_TYPE)
        {
            return Err(fail(&format!(
                "a ui:// entry must have the mimeType {MCP_APP_MIME_TYPE}"
            )));
        }
        for (key, value) in &entry.meta {
            check_meta_entry(key, value, false).map_err(|reason| fail(&reason))?;
        }
        if let Some(content) = &entry.content {
            if entry.size != Some(content.bytes.len() as u64) {
                return Err(fail(
                    "the size must equal the length of the content's bytes",
                ));
            }
        }
    }
    Ok(())
}

/// One `contents` item: `text` when the bytes are valid UTF-8, otherwise `blob`.
fn content_item(
    uri: &str,
    mime_type: Option<&str>,
    bytes: &[u8],
    meta: Option<&Map<String, Value>>,
) -> Value {
    let mut item = Map::new();
    item.insert("uri".into(), json!(uri));
    if let Some(mime_type) = mime_type {
        item.insert("mimeType".into(), json!(mime_type));
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => item.insert("text".into(), json!(text)),
        Err(_) => item.insert("blob".into(), json!(base64(bytes))),
    };
    if let Some(meta) = meta.filter(|meta| !meta.is_empty()) {
        item.insert("_meta".into(), Value::Object(meta.clone()));
    }
    Value::Object(item)
}

fn not_found(uri: &str) -> ErrorData {
    ErrorData::invalid_params("Resource not found", Some(json!({ "uri": uri })))
}

fn method_not_found(method: &str) -> ErrorData {
    ErrorData::new(
        rmcp::model::ErrorCode::METHOD_NOT_FOUND,
        method.to_owned(),
        None,
    )
}

fn refuse_cursor(cursor: Option<&String>) -> Result<(), ErrorData> {
    match cursor {
        None => Ok(()),
        Some(_) => Err(ErrorData::invalid_params(
            "This server returns one page and never issues a cursor",
            None,
        )),
    }
}

/// Add the modern era's `resultType`, `ttlMs` and `cacheScope` to a result.
fn with_hints(mut result: Value, modern: bool, ttl_ms: u64) -> Value {
    if modern {
        result["resultType"] = json!("complete");
        result["ttlMs"] = json!(ttl_ms);
        result["cacheScope"] = json!("public");
    }
    result
}

impl McpServer {
    /// Whether this server was given a resource provider, a skill catalog or both.
    pub(super) fn serves_resources(&self) -> bool {
        self.inner.resources.is_some() || self.inner.skills.is_some()
    }

    /// The `ttlMs` of resource results: the `tools/list` option, not lowered by contexts,
    /// because these results do not vary by context.
    fn resources_ttl_ms(&self) -> u64 {
        self.inner
            .tools_list_ttl_ms
            .unwrap_or(super::DEFAULT_TOOLS_LIST_TTL_MS)
    }

    /// Check the provider's entries (R2). The catalog was checked when it was built.
    pub(super) fn validate_resources(&self) -> Result<(), String> {
        match &self.inner.resources {
            Some(provider) => check_entries(&provider.list()),
            None => Ok(()),
        }
    }

    /// The provider's entries after the check, or `-32603`.
    fn provider_entries(&self) -> Result<Vec<ResourceEntry>, ErrorData> {
        let Some(provider) = &self.inner.resources else {
            return Ok(Vec::new());
        };
        let entries = provider.list();
        check_entries(&entries).map_err(internal)?;
        Ok(entries)
    }

    pub(super) async fn serve_list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        context: &RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        if !self.serves_resources() {
            return Ok(ListResourcesResult::default());
        }
        panic_guard::guard_request(async {
            refuse_cursor(request.as_ref().and_then(|request| request.cursor.as_ref()))?;
            let mut resources: Vec<Value> = self
                .provider_entries()?
                .iter()
                .map(ResourceEntry::to_json)
                .collect();
            if let Some(skills) = &self.inner.skills {
                resources.extend(skills.resources().cloned());
            }
            serde_json::from_value(with_hints(
                json!({ "resources": resources }),
                confirmations::is_modern(context),
                self.resources_ttl_ms(),
            ))
            .map_err(internal)
        })
        .await
    }

    pub(super) async fn serve_list_resource_templates(
        &self,
        request: Option<PaginatedRequestParams>,
        context: &RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        if !self.serves_resources() {
            return Ok(ListResourceTemplatesResult::default());
        }
        refuse_cursor(request.as_ref().and_then(|request| request.cursor.as_ref()))?;
        serde_json::from_value(with_hints(
            json!({ "resourceTemplates": [] }),
            confirmations::is_modern(context),
            self.resources_ttl_ms(),
        ))
        .map_err(internal)
    }

    pub(super) async fn serve_read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: &RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        if !self.serves_resources() {
            return Err(method_not_found("resources/read"));
        }
        panic_guard::guard_request(async {
            let uri = request.uri.as_str();
            let item = self.read_item(uri).await?;
            let result: ReadResourceResult = serde_json::from_value(with_hints(
                json!({ "contents": [item] }),
                confirmations::is_modern(context),
                self.resources_ttl_ms(),
            ))
            .map_err(internal)?;
            Ok(ReadResourceResponse::Complete(result))
        })
        .await
    }

    /// The one `contents` item for `uri`.
    async fn read_item(&self, uri: &str) -> Result<Value, ErrorData> {
        if let Some(file) = self
            .inner
            .skills
            .as_ref()
            .and_then(|skills| skills.file(uri))
        {
            return Ok(content_item(uri, Some(file.mime_type), &file.bytes, None));
        }
        // The `skill://` scheme is the catalog's alone (R2): a provider is never asked for it.
        let skill_scheme =
            scheme_of(uri).is_some_and(|scheme| scheme.eq_ignore_ascii_case("skill"));
        let Some(provider) = self.inner.resources.as_ref().filter(|_| !skill_scheme) else {
            return Err(not_found(uri));
        };
        let entries = self.provider_entries()?;
        let entry = entries.iter().find(|entry| entry.uri == uri);
        if let Some(content) = entry.and_then(|entry| entry.content.as_ref()) {
            return Ok(content_item(
                uri,
                entry.and_then(|entry| entry.mime_type.as_deref()),
                &content.bytes,
                None,
            ));
        }
        let contents = provider.read(uri).await.map_err(|error| match error {
            ResourceReadError::NotFound => not_found(uri),
            ResourceReadError::Failed(_) => {
                ErrorData::internal_error("The resource could not be read", None)
            }
        })?;
        for (key, value) in &contents.meta {
            check_meta_entry(key, value, true)
                .map_err(|reason| internal(format!("resource \"{uri}\": {reason}")))?;
        }
        if let Some(size) = entry.and_then(|entry| entry.size) {
            if size != contents.bytes.len() as u64 {
                return Err(internal(format!(
                    "resource \"{uri}\": the listed size is {size} but the read returned {} bytes",
                    contents.bytes.len()
                )));
            }
        }
        let mime_type = entry
            .and_then(|entry| entry.mime_type.as_deref())
            .or(contents.mime_type.as_deref());
        Ok(content_item(
            uri,
            mime_type,
            &contents.bytes,
            Some(&contents.meta),
        ))
    }

    /// `skills/list`, `skills/get` and `resources/directory/read`: the methods `rmcp` hands to
    /// [`ServerHandler::on_custom_request`](rmcp::ServerHandler::on_custom_request).
    pub(super) async fn serve_custom_request(
        &self,
        request: CustomRequest,
        context: &RequestContext<RoleServer>,
    ) -> Result<CustomResult, ErrorData> {
        let method = request.method.as_str();
        let Some(skills) = self.inner.skills.as_ref() else {
            return Err(method_not_found(method));
        };
        let modern = confirmations::is_modern(context);
        let ttl_ms = self.resources_ttl_ms();
        let params = request.params.as_ref();
        let uri = || -> Result<&str, ErrorData> {
            params
                .and_then(|params| params.get("uri"))
                .and_then(Value::as_str)
                .ok_or_else(|| ErrorData::invalid_params("params.uri must be a string", None))
        };
        let result = match method {
            SKILLS_LIST => {
                refuse_cursor(
                    params
                        .and_then(|params| params.get("cursor"))
                        .map(|cursor| cursor.as_str().unwrap_or_default().to_owned())
                        .as_ref(),
                )?;
                json!({ "skills": skills.entries() })
            }
            SKILLS_GET => {
                let uri = uri()?;
                let entry = skills.entry(uri).ok_or_else(|| not_found(uri))?;
                json!({ "skill": entry })
            }
            DIRECTORY_READ if skills.directory_read() => {
                let uri = uri()?;
                let children = skills.directory(uri).ok_or_else(|| not_found(uri))?;
                json!({ "resources": children })
            }
            _ => return Err(method_not_found(method)),
        };
        Ok(CustomResult::new(with_hints(result, modern, ttl_ms)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemes_need_rfc_3986_syntax() {
        assert_eq!(scheme_of("file:///a"), Some("file"));
        assert_eq!(scheme_of("ui://a/b.html"), Some("ui"));
        assert_eq!(scheme_of("a+b-c.d:x"), Some("a+b-c.d"));
        for bad in [
            "",
            "no-scheme",
            "1a:x",
            ":x",
            "a b:x",
            "a:b c",
            "a:b\nc",
            "/a/b",
        ] {
            assert_eq!(scheme_of(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn entries_are_checked() {
        let ok = |entry: ResourceEntry| check_entries(&[entry]);
        assert!(ok(ResourceEntry::new("file:///a", "a")).is_ok());
        assert!(ok(ResourceEntry::new("file:///a", "a").with_bytes("x")).is_ok());
        assert!(
            ok(ResourceEntry::new("file:///a", "a").with_meta("com.example/k", json!(1))).is_ok()
        );
        assert!(
            ok(ResourceEntry::new("ui://v/a.html", "v").with_mime_type(MCP_APP_MIME_TYPE)).is_ok()
        );
        for (entry, expected) in [
            (ResourceEntry::new("a", "a"), "scheme"),
            (ResourceEntry::new("file:///a", ""), "name"),
            (ResourceEntry::new("skill://a/SKILL.md", "a"), "skill"),
            (ResourceEntry::new("SKILL://a/SKILL.md", "a"), "skill"),
            (ResourceEntry::new("ui://v/a.html", "v"), "mimeType"),
            (
                ResourceEntry::new("ui://v/a.html", "v").with_mime_type("text/html"),
                "mimeType",
            ),
            (
                ResourceEntry::new("file:///a", "a").with_meta("ui", json!({})),
                "ui",
            ),
            (
                ResourceEntry::new("file:///a", "a").with_meta("dev.afd/digest", json!("x")),
                "dev.afd/digest",
            ),
            (
                ResourceEntry::new("file:///a", "a")
                    .with_bytes("xy")
                    .with_size(3),
                "size",
            ),
        ] {
            let error = ok(entry).unwrap_err();
            assert!(error.contains(expected), "{expected}: {error}");
        }
        let twice = [
            ResourceEntry::new("file:///a", "a"),
            ResourceEntry::new("file:///a", "b"),
        ];
        assert!(check_entries(&twice).unwrap_err().contains("another entry"));
    }

    #[test]
    fn static_entries_carry_size_and_digest() {
        let entry = ResourceEntry::new("file:///a", "a")
            .with_mime_type("text/plain")
            .with_text("abc");
        let item = entry.to_json();
        assert_eq!(item["size"], 3);
        assert_eq!(
            item["_meta"][DIGEST_META_KEY],
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn content_is_text_or_blob() {
        assert_eq!(
            content_item("file:///a", Some("text/plain"), b"hi", None),
            json!({ "uri": "file:///a", "mimeType": "text/plain", "text": "hi" })
        );
        assert_eq!(
            content_item("file:///a", None, &[0xff, 0x00, 0xfe], None),
            json!({ "uri": "file:///a", "blob": "/wD+" })
        );
    }
}
