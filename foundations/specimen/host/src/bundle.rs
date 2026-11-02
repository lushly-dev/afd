//! Rolldown bundling of a bench: the browser runtime plus a lazy chunk per specimen module.
//! Each generation is held in memory; before a render the generation's source files are checked,
//! and any change rebuilds it. A module that fails to bundle fails only the specimens that use
//! it, as under Vite's development server.

use anyhow::{Result, anyhow};
use rolldown::{
    BundlerOptions, InputItem, ModuleType, OutputFormat, Platform, ResolveOptions, TsConfig,
};
use rolldown_common::{InnerOptions, ModuleSideEffects, TreeshakeOptions};
use rolldown_plugin::{
    HookLoadArgs, HookLoadOutput, HookLoadReturn, HookUsage, Plugin, SharedLoadPluginContext,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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
    /// A source changed while this generation was being built.
    changed_while_building: bool,
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

/// Whether a `throw`'s argument awaits at module level, outside any nested function.
#[derive(Default)]
struct Awaits(bool);

impl<'a> oxc::ast_visit::Visit<'a> for Awaits {
    fn visit_await_expression(&mut self, _: &oxc::ast::ast::AwaitExpression<'a>) {
        self.0 = true;
    }
    fn visit_function(
        &mut self,
        _: &oxc::ast::ast::Function<'a>,
        _: oxc::syntax::scope::ScopeFlags,
    ) {
    }
    fn visit_arrow_function_expression(&mut self, _: &oxc::ast::ast::ArrowFunctionExpression<'a>) {}
}

/// Oxc's dead-code pass removes a declaration that follows an unconditional top-level
/// `throw` but keeps its export, so the module fails to link instead of throwing its own
/// error. Each such `throw` runs in a function called in its place: the same error at the
/// same point, without making the code after it statically unreachable. A leading `;` keeps
/// the call from joining the previous line, and a `throw` that awaits runs in an awaited
/// async function.
fn guard_top_level_throws(path: &str, source: &str) -> Option<String> {
    use oxc::ast_visit::Visit;
    if !source.contains("throw") {
        return None;
    }
    let allocator = oxc::allocator::Allocator::default();
    let source_type = oxc::span::SourceType::from_path(path).ok()?;
    // A source that does not parse has no statements here; the bundler reports its error.
    let parsed = oxc::parser::Parser::new(&allocator, source, source_type).parse();
    let throws: Vec<_> = parsed
        .program
        .body
        .iter()
        .filter_map(|statement| match statement {
            oxc::ast::ast::Statement::ThrowStatement(throw) => {
                let mut awaits = Awaits::default();
                awaits.visit_expression(&throw.argument);
                Some((throw.span, awaits.0))
            }
            _ => None,
        })
        .collect();
    if throws.is_empty() {
        return None;
    }
    let mut guarded = String::with_capacity(source.len() + throws.len() * 24);
    let mut last = 0;
    for (span, awaits) in throws {
        let (start, end) = (span.start as usize, span.end as usize);
        guarded.push_str(&source[last..start]);
        guarded.push_str(if awaits {
            ";await (async () => { "
        } else {
            ";(() => { "
        });
        guarded.push_str(&source[start..end]);
        guarded.push_str(" })();");
        last = end;
    }
    guarded.push_str(&source[last..]);
    Some(guarded)
}

/// Files the load hook emits, such as `?url` imports and assets a stylesheet references,
/// served as `assets/<name>-<hash>.<extension>`.
type Assets = Arc<Mutex<BTreeMap<String, Vec<u8>>>>;

fn emit(assets: &Assets, path: &Path) -> Result<String> {
    let body = std::fs::read(path)?;
    let hash = format!("{:x}", Sha256::digest(&body));
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("asset");
    let name = match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) => format!("assets/{stem}-{}.{extension}", &hash[..8]),
        None => format!("assets/{stem}-{}", &hash[..8]),
    };
    assets.lock().unwrap().insert(name.clone(), body);
    Ok(name)
}

/// A reference a stylesheet resolves against its own file, not a URL or an absolute path.
fn relative_reference(reference: &str) -> bool {
    !reference.is_empty() && !reference.starts_with(['/', '#']) && !reference.contains(':')
}

/// The stylesheet's text, with relative `@import`s inlined and relative `url()`s pointing at
/// emitted assets, as Vite's CSS handling resolves them. Text a reference cannot be resolved
/// for is kept as written.
fn stylesheet(path: &Path, assets: &Assets, seen: &mut Vec<PathBuf>) -> Result<String> {
    let css = std::fs::read_to_string(path)?;
    seen.push(path.to_path_buf());
    let directory = path.parent().unwrap_or(Path::new("/"));
    let mut out = String::with_capacity(css.len());
    let mut rest = css.as_str();
    while !rest.is_empty() {
        let next = [rest.find("@import"), rest.find("url(")]
            .into_iter()
            .flatten()
            .min();
        let Some(at) = next else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        if rest.starts_with("@import") {
            // `@import "x.css";` or `@import url(x.css);`, without media or layer conditions.
            let end = rest.find(';').map_or(rest.len(), |end| end + 1);
            let statement = &rest[..end];
            let argument = statement["@import".len()..]
                .trim()
                .trim_end_matches(';')
                .trim();
            let argument = argument
                .strip_prefix("url(")
                .and_then(|inner| inner.strip_suffix(')'))
                .unwrap_or(argument)
                .trim()
                .trim_matches(['"', '\'']);
            let target = directory.join(argument);
            let simple = !argument.contains([' ', ')']) && relative_reference(argument);
            if simple && target.is_file() && !seen.contains(&target) {
                out.push_str(&stylesheet(&target, assets, seen)?);
            } else {
                out.push_str(statement);
            }
            rest = &rest[end..];
            continue;
        }
        let Some(close) = rest.find(')') else {
            out.push_str(rest);
            break;
        };
        let reference = rest["url(".len()..close].trim();
        let unquoted = reference.trim_matches(['"', '\'']);
        let target = directory.join(unquoted.split(['?', '#']).next().unwrap_or(unquoted));
        if relative_reference(unquoted) && target.is_file() {
            out.push_str(&format!("url(\"./{}\")", emit(assets, &target)?));
        } else {
            out.push_str(&rest[..=close]);
        }
        rest = &rest[close + 1..];
    }
    Ok(out)
}

/// Vite's import forms for non-script files: `.css` imports inject a style element, as Vite's
/// development server does, `?inline` CSS and `?raw` files become strings, and `?url` imports
/// emit the file and resolve to its served path. Project modules have their `import.meta.glob`
/// calls expanded (`glob.rs`) and their top-level `throw`s guarded (`guard_top_level_throws`).
#[derive(Debug)]
struct SpecimenLoad {
    assets: Assets,
    /// The bench root, which a `/` glob pattern starts from.
    root: PathBuf,
}

impl SpecimenLoad {
    fn module(code: String) -> HookLoadReturn {
        Ok(Some(HookLoadOutput {
            code: code.into(),
            module_type: Some(ModuleType::Js),
            ..Default::default()
        }))
    }
}

impl Plugin for SpecimenLoad {
    fn name(&self) -> Cow<'static, str> {
        Cow::Borrowed("specimen:load")
    }

    async fn load(&self, _ctx: SharedLoadPluginContext, args: &HookLoadArgs<'_>) -> HookLoadReturn {
        let (path, query) = args.id.split_once('?').unwrap_or((args.id, ""));
        let path = path.split('#').next().unwrap_or(path);
        let flags: Vec<&str> = query
            .split(['&', '#'])
            .map(|flag| flag.split('=').next().unwrap_or(flag))
            .filter(|flag| !flag.is_empty())
            .collect();
        if flags.contains(&"raw") {
            let text = std::fs::read_to_string(path)?;
            return Self::module(format!(
                "export default {};\n",
                serde_json::to_string(&text)?
            ));
        }
        if flags.contains(&"url") {
            let name = emit(&self.assets, Path::new(path))?;
            return Self::module(format!(
                "export default {};\n",
                serde_json::to_string(&format!("./{name}"))?
            ));
        }
        if let Some(flag) = flags
            .iter()
            .find(|flag| !matches!(**flag, "inline" | "direct" | "used"))
        {
            return Err(anyhow!("Unsupported import query \"?{flag}\" in {path}"));
        }
        if path.ends_with(".css") {
            let css = stylesheet(Path::new(path), &self.assets, &mut Vec::new())?;
            if flags.contains(&"inline") {
                return Self::module(format!(
                    "export default {};\n",
                    serde_json::to_string(&css)?
                ));
            }
            return Self::module(format!(
                "const css = {};\nif (typeof document !== 'undefined') {{ const style = document.createElement('style'); style.dataset.specimenCss = {}; style.textContent = css; document.head.append(style); }}\nexport default css;\n",
                serde_json::to_string(&css)?,
                serde_json::to_string(path)?
            ));
        }
        let script = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]
            .iter()
            .any(|extension| path.ends_with(extension));
        if !script || path.contains("/node_modules/") {
            return Ok(None);
        }
        let Ok(source) = std::fs::read_to_string(path) else {
            return Ok(None);
        };
        let globbed = crate::glob::import_globs(path, &source, &self.root)?;
        let expanded = globbed.is_some();
        let source = globbed.unwrap_or(source);
        let code = guard_top_level_throws(path, &source).or(expanded.then_some(source));
        Ok(code.map(|code| HookLoadOutput {
            code: code.into(),
            ..Default::default()
        }))
    }

    fn register_hook_usage(&self) -> HookUsage {
        HookUsage::Load
    }
}

const PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Specimens</title></head><body><main id=\"specimen-root\"></main><script type=\"module\" src=\"./specimen.js\"></script></body></html>";

fn content_type(file: &str) -> &'static str {
    match Path::new(file)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("txt") => "text/plain; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("wasm") => "application/wasm",
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

/// The page entry: every module's loader, or, for a module that failed to bundle, a loader
/// that rejects with its bundling error.
fn entry_source(source: &BenchSource, failed: &BTreeMap<String, String>) -> Result<String> {
    let loaders: Vec<String> = source
        .modules
        .iter()
        .map(|(id, file)| {
            let loader = match failed.get(file) {
                Some(message) => format!(
                    "() => Promise.reject(new Error({}))",
                    serde_json::to_string(message)?
                ),
                None => format!("() => import({})", serde_json::to_string(file)?),
            };
            Ok(format!("{}: {loader}", serde_json::to_string(id)?))
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

struct Output {
    files: HashMap<String, ServedFile>,
    sources: Vec<PathBuf>,
}

/// Every imported source module runs, as under Vite's development server, even inside a
/// package that declares `"sideEffects": false`: a story's `import './element.js'` that only
/// registers a custom element must not be shaken away. Dependencies keep their own rules.
fn source_side_effects() -> TreeshakeOptions {
    TreeshakeOptions::Option(InnerOptions {
        module_side_effects: ModuleSideEffects::Function(Arc::new(|id: &str, external: bool| {
            let source = !external && !id.contains("/node_modules/");
            Box::pin(async move { Ok(source.then_some(true)) })
        })),
        ..Default::default()
    })
}

/// One Rolldown build of the page with the given modules, the rest rejected with their errors.
async fn bundle(
    source: &BenchSource,
    modules: &BenchSource,
    failed: &BTreeMap<String, String>,
) -> Result<Output> {
    std::fs::create_dir_all(&source.work)?;
    let entry = source.work.join(format!(
        "__specimen_entry_{}__.js",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&entry, entry_source(modules, failed)?)?;
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
        treeshake: source_side_effects(),
        ..Default::default()
    };
    let assets: Assets = Arc::default();
    let plugin = SpecimenLoad {
        assets: assets.clone(),
        root: source.root.clone(),
    };
    let built = async {
        let mut bundler =
            rolldown::Bundler::with_plugins(options, vec![SpecimenLoad::new_shared(plugin)])
                .map_err(|errors| anyhow!("{errors:?}"))?;
        bundler.generate().await.map_err(|errors| {
            anyhow!(
                "Bundling failed: {}",
                errors
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        })
    }
    .await;
    let _ = std::fs::remove_file(&entry);
    let output = built?;
    let mut files = HashMap::new();
    let mut sources = Vec::new();
    for asset in &output.assets {
        let name = asset.filename().to_string();
        if let rolldown_common::Output::Chunk(chunk) = asset {
            for id in &chunk.module_ids {
                let path = PathBuf::from(id.as_str().split(['?', '#']).next().unwrap_or(""));
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
    for (name, body) in std::mem::take(&mut *assets.lock().unwrap()) {
        files.insert(name.clone(), served(body, &name));
    }
    Ok(Output { files, sources })
}

pub async fn build(source: &BenchSource) -> Result<Generation> {
    let started = SystemTime::now();
    let mut failed = BTreeMap::new();
    let output = match bundle(source, source, &failed).await {
        Ok(output) => output,
        Err(error) => {
            // Find the modules that fail on their own, then bundle the rest.
            let mut files: Vec<&String> = source.modules.iter().map(|(_, file)| file).collect();
            files.sort();
            files.dedup();
            for file in files {
                let alone = BenchSource {
                    modules: source
                        .modules
                        .iter()
                        .filter(|(_, module)| module == file)
                        .cloned()
                        .collect(),
                    ..source.clone()
                };
                if let Err(module_error) = bundle(source, &alone, &BTreeMap::new()).await {
                    failed.insert(file.clone(), format!("{module_error:#}"));
                }
            }
            if failed.is_empty() {
                return Err(error);
            }
            let mut output = bundle(source, source, &failed).await?;
            // A failed module's own file is watched, so fixing it rebuilds the bench.
            output.sources.extend(failed.keys().map(PathBuf::from));
            output
        }
    };
    let Output {
        mut files,
        mut sources,
    } = output;
    files.insert(
        "specimen.html".into(),
        served(PAGE.as_bytes().to_vec(), "specimen.html"),
    );
    sources.sort();
    sources.dedup();
    let mut changed_while_building = false;
    let watched = sources
        .into_iter()
        .map(|path| {
            let (modified, size) = file_state(&path);
            changed_while_building |= modified.is_none_or(|modified| modified >= started);
            (path, modified, size)
        })
        .collect();
    Ok(Generation {
        files,
        watched,
        changed_while_building,
    })
}

impl Generation {
    /// Whether any bundled source changed since this generation's build began.
    pub fn stale(&self) -> bool {
        self.changed_while_building
            || self
                .watched
                .iter()
                .any(|(path, modified, size)| file_state(path) != (*modified, *size))
    }
}

#[cfg(test)]
mod tests {
    use super::{Assets, guard_top_level_throws, stylesheet};

    #[test]
    fn guards_only_top_level_throws() {
        let source = "throw new Error('marker');\nexport const Kept = 1;\nfunction inner() { throw new Error('inner'); }\n";
        assert_eq!(
            guard_top_level_throws("module.ts", source).as_deref(),
            Some(
                ";(() => { throw new Error('marker'); })();\nexport const Kept = 1;\nfunction inner() { throw new Error('inner'); }\n"
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

    #[test]
    fn keeps_line_breaks_and_awaits_meaningful() {
        let source = "const f = () => 1\nthrow await Promise.reject(new Error('x'))\nexport const g = () => { throw await 1; };\n";
        assert_eq!(
            guard_top_level_throws("module.ts", source).as_deref(),
            Some(
                "const f = () => 1\n;await (async () => { throw await Promise.reject(new Error('x')) })();\nexport const g = () => { throw await 1; };\n"
            )
        );
    }

    #[test]
    fn inlines_imports_and_emits_referenced_assets() {
        let directory = std::env::temp_dir().join(format!("specimen-css-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("nested")).unwrap();
        std::fs::write(
            directory.join("nested/base.css"),
            "a { background: url('dot.png'); }",
        )
        .unwrap();
        std::fs::write(directory.join("nested/dot.png"), b"png").unwrap();
        std::fs::write(
            directory.join("main.css"),
            "@import \"./nested/base.css\";\n@import url(https://fonts.example/x.css);\nb { mask: url(#m); }",
        )
        .unwrap();
        let assets: Assets = Assets::default();
        let css = stylesheet(&directory.join("main.css"), &assets, &mut Vec::new()).unwrap();
        let emitted: Vec<String> = assets.lock().unwrap().keys().cloned().collect();
        assert_eq!(emitted.len(), 1);
        assert!(emitted[0].starts_with("assets/dot-") && emitted[0].ends_with(".png"));
        assert_eq!(
            css,
            format!(
                "a {{ background: url(\"./{}\"); }}\n@import url(https://fonts.example/x.css);\nb {{ mask: url(#m); }}",
                emitted[0]
            )
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
