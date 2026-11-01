//! Rolldown bundling of a bench: the browser runtime plus a lazy chunk per specimen module.
//! Each generation is held in memory; before a render the generation's source files are checked,
//! and any change rebuilds it.

use anyhow::{Result, anyhow};
use rolldown::{
    BundlerOptions, InputItem, ModuleType, OutputFormat, Platform, ResolveOptions, TsConfig,
};
use rolldown_plugin::{
    HookLoadArgs, HookLoadOutput, HookLoadReturn, HookUsage, Plugin, SharedLoadPluginContext,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct ServedFile {
    pub body: Arc<Vec<u8>>,
    pub content_type: &'static str,
    pub digest: String,
}

#[derive(Debug)]
pub struct Generation {
    pub files: HashMap<String, ServedFile>,
    watched: Vec<(PathBuf, Option<SystemTime>, u64)>,
}

/// What a bench bundles: the configured specimen modules, the runtime and its defaults.
#[derive(Debug, Clone)]
pub struct BenchSource {
    pub root: PathBuf,
    pub runtime: String,
    pub modules: Vec<(String, String)>,
    pub entries: Value,
    pub defaults: Value,
    pub work: PathBuf,
}

/// Oxc's dead-code pass removes a declaration that follows an unconditional top-level
/// `throw` but keeps its export, so the module fails to link instead of throwing its own
/// error. Each such `throw` runs in an arrow function called in its place: the same error at
/// the same point, without making the code after it statically unreachable.
fn guard_top_level_throws(path: &str, source: &str) -> Option<String> {
    if !source.contains("throw") {
        return None;
    }
    let allocator = oxc::allocator::Allocator::default();
    let source_type = oxc::span::SourceType::from_path(path).ok()?;
    // A source that does not parse has no statements here; the bundler reports its error.
    let parsed = oxc::parser::Parser::new(&allocator, source, source_type).parse();
    let spans: Vec<_> = parsed
        .program
        .body
        .iter()
        .filter_map(|statement| match statement {
            oxc::ast::ast::Statement::ThrowStatement(throw) => Some(throw.span),
            _ => None,
        })
        .collect();
    if spans.is_empty() {
        return None;
    }
    let mut guarded = String::with_capacity(source.len() + spans.len() * 16);
    let mut last = 0;
    for span in spans {
        let (start, end) = (span.start as usize, span.end as usize);
        guarded.push_str(&source[last..start]);
        guarded.push_str("(() => { ");
        guarded.push_str(&source[start..end]);
        guarded.push_str(" })();");
        last = end;
    }
    guarded.push_str(&source[last..]);
    Some(guarded)
}

/// `.css` imports become modules that inject a style element, as Vite's dev server does, and
/// project modules have top-level `throw`s guarded (`guard_top_level_throws`).
#[derive(Debug)]
struct SpecimenLoad;

impl Plugin for SpecimenLoad {
    fn name(&self) -> Cow<'static, str> {
        Cow::Borrowed("specimen:load")
    }

    async fn load(&self, _ctx: SharedLoadPluginContext, args: &HookLoadArgs<'_>) -> HookLoadReturn {
        let path = args.id.split(['?', '#']).next().unwrap_or(args.id);
        if !path.ends_with(".css") {
            let script = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]
                .iter()
                .any(|extension| path.ends_with(extension));
            if !script || path.contains("/node_modules/") {
                return Ok(None);
            }
            let Ok(source) = std::fs::read_to_string(path) else {
                return Ok(None);
            };
            return Ok(
                guard_top_level_throws(path, &source).map(|code| HookLoadOutput {
                    code: code.into(),
                    ..Default::default()
                }),
            );
        }
        let css = std::fs::read_to_string(path)?;
        let code = format!(
            "const css = {};\nif (typeof document !== 'undefined') {{ const style = document.createElement('style'); style.dataset.specimenCss = {}; style.textContent = css; document.head.append(style); }}\nexport default css;\n",
            serde_json::to_string(&css)?,
            serde_json::to_string(path)?
        );
        Ok(Some(HookLoadOutput {
            code: code.into(),
            module_type: Some(ModuleType::Js),
            ..Default::default()
        }))
    }

    fn register_hook_usage(&self) -> HookUsage {
        HookUsage::Load
    }
}

const PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Specimens</title></head><body><main id=\"specimen-root\"></main><script type=\"module\" src=\"./specimen.js\"></script></body></html>";

fn content_type(file: &str) -> &'static str {
    match Path::new(file).extension().and_then(|value| value.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn served(body: Vec<u8>, file: &str) -> ServedFile {
    let digest = format!("{:x}", Sha256::digest(&body));
    ServedFile {
        body: Arc::new(body),
        content_type: content_type(file),
        digest,
    }
}

fn entry_source(source: &BenchSource) -> Result<String> {
    let loaders: Vec<String> = source
        .modules
        .iter()
        .map(|(id, file)| {
            Ok(format!(
                "{}: () => import({})",
                serde_json::to_string(id)?,
                serde_json::to_string(file)?
            ))
        })
        .collect::<Result<_>>()?;
    Ok(format!(
        "import {{ installRuntime, installPage }} from {};\nconst entries = {};\ninstallRuntime({{{}}});\nawait installPage(entries, {});\n",
        serde_json::to_string(&source.runtime)?,
        source.entries,
        loaders.join(","),
        source.defaults
    ))
}

fn file_state(path: &Path) -> (Option<SystemTime>, u64) {
    match std::fs::metadata(path) {
        Ok(metadata) => (metadata.modified().ok(), metadata.len()),
        Err(_) => (None, 0),
    }
}

pub async fn build(source: &BenchSource) -> Result<Generation> {
    std::fs::create_dir_all(&source.work)?;
    let entry = source.work.join("__specimen_entry__.js");
    std::fs::write(&entry, entry_source(source)?)?;
    let tsconfig = source.root.join("tsconfig.json");
    // Vite's development build environment, which the dev server and earlier builds gave cases.
    let define = [
        ("import.meta.env.DEV", "true"),
        ("import.meta.env.PROD", "false"),
        ("import.meta.env.SSR", "false"),
        ("import.meta.env.MODE", "\"development\""),
        ("import.meta.env.BASE_URL", "\"./\""),
        ("process.env.NODE_ENV", "\"development\""),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value.to_string()))
    .collect();
    let options = BundlerOptions {
        input: Some(vec![InputItem {
            name: Some("specimen".into()),
            import: entry.display().to_string(),
        }]),
        cwd: Some(source.root.clone()),
        platform: Some(Platform::Browser),
        format: Some(OutputFormat::Esm),
        tsconfig: Some(if tsconfig.exists() {
            TsConfig::Manual(tsconfig)
        } else {
            TsConfig::Auto(true)
        }),
        define: Some(define),
        resolve: Some(ResolveOptions {
            condition_names: Some(
                ["development", "module", "browser", "import", "default"]
                    .map(String::from)
                    .to_vec(),
            ),
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut bundler =
        rolldown::Bundler::with_plugins(options, vec![SpecimenLoad::new_shared(SpecimenLoad)])
            .map_err(|errors| anyhow!("{errors:?}"))?;
    let output = bundler.generate().await.map_err(|errors| {
        anyhow!(
            "Bundling failed: {}",
            errors
                .iter()
                .map(|error| format!("{error:?}"))
                .collect::<Vec<_>>()
                .join("; ")
        )
    })?;
    let mut files = HashMap::new();
    let mut sources = Vec::new();
    for asset in &output.assets {
        let name = asset.filename().to_string();
        if let rolldown_common::Output::Chunk(chunk) = asset {
            for id in &chunk.module_ids {
                let path = id.as_str().split(['?', '#']).next().unwrap_or("");
                let path = PathBuf::from(path);
                if path.is_absolute() && !path.starts_with(&source.work) {
                    sources.push(path);
                }
            }
        }
        files.insert(
            name.clone(),
            served(asset.content_as_bytes().to_vec(), &name),
        );
    }
    files.insert(
        "specimen.html".into(),
        served(PAGE.as_bytes().to_vec(), "specimen.html"),
    );
    sources.sort();
    sources.dedup();
    let watched = sources
        .into_iter()
        .map(|path| {
            let (modified, size) = file_state(&path);
            (path, modified, size)
        })
        .collect();
    Ok(Generation { files, watched })
}

impl Generation {
    /// Whether any bundled source changed since this generation was built.
    pub fn stale(&self) -> bool {
        self.watched
            .iter()
            .any(|(path, modified, size)| file_state(path) != (*modified, *size))
    }
}

#[cfg(test)]
mod tests {
    use super::guard_top_level_throws;

    #[test]
    fn guards_only_top_level_throws() {
        let source = "throw new Error('marker');\nexport const Kept = 1;\nfunction inner() { throw new Error('inner'); }\n";
        assert_eq!(
            guard_top_level_throws("module.ts", source).as_deref(),
            Some(
                "(() => { throw new Error('marker'); })();\nexport const Kept = 1;\nfunction inner() { throw new Error('inner'); }\n"
            )
        );
        assert_eq!(
            guard_top_level_throws("module.ts", "export function f() { throw 1; }"),
            None
        );
        assert_eq!(
            guard_top_level_throws("module.ts", "export const value = 1;"),
            None
        );
    }
}
