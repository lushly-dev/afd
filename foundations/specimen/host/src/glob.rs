//! Vite's `import.meta.glob` for the bundler. Each call becomes the object of matching modules
//! Vite's transform writes: `{ './a.ts': () => import('./a.ts') }`, or with `eager`, the
//! modules imported statically. The literal forms Vite documents are supported: a pattern or an
//! array of patterns (`!` excludes) relative to the importing file or, with a leading `/`, to
//! the bench root, and the `eager`, `import` and `query` options. Any other argument fails the
//! module, naming what is unsupported, rather than bundling a call that throws when it runs.

use crate::csf::index::walk;
use crate::csf::value::{Scope, Value};
use anyhow::{Result, anyhow, bail};
use oxc::ast::ast::{CallExpression, Expression};
use oxc::ast_visit::{Visit, walk as visit};
use oxc::span::GetSpan;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

/// `import.meta.glob(...)` calls, outermost first, with their arguments evaluated statically.
struct Calls<'s, 'p, 'a> {
    scope: &'s Scope<'p, 'a>,
    found: Vec<(u32, u32, Vec<Value>)>,
}

fn is_import_glob(callee: &Expression) -> bool {
    let Expression::StaticMemberExpression(member) = callee.without_parentheses() else {
        return false;
    };
    matches!(
        member.object.without_parentheses(),
        Expression::ImportMeta(_)
    ) && member.property.name.as_str() == "glob"
}

impl<'a> Visit<'a> for Calls<'_, '_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if !is_import_glob(&call.callee) {
            return visit::walk_call_expression(self, call);
        }
        let values = call
            .arguments
            .iter()
            .map(|argument| match argument.as_expression() {
                Some(expression) => self.scope.evaluate(expression),
                None => Value::Unknown("a spread argument".into()),
            })
            .collect();
        let span = call.span();
        self.found.push((span.start, span.end, values));
    }
}

#[derive(Default)]
struct Options {
    eager: bool,
    import: Option<String>,
    query: String,
}

fn options(value: Option<&Value>) -> Result<Options> {
    let mut options = Options::default();
    let object = match value {
        None | Some(Value::Undefined) => return Ok(options),
        Some(Value::Object(object)) if object.open.is_none() => object,
        Some(other) => bail!("needs literal options, not {}", other.kind()),
    };
    for (key, value) in &object.fields {
        match (key.as_str(), value) {
            ("eager", Value::Bool(eager)) => options.eager = *eager,
            ("import", Value::String(name)) => options.import = Some(name.clone()),
            ("query", Value::String(query)) if !query.is_empty() => {
                options.query = if query.starts_with('?') {
                    query.clone()
                } else {
                    format!("?{query}")
                };
            }
            (key, value) => bail!("option `{key}` ({}) is not supported", value.kind()),
        }
    }
    Ok(options)
}

fn patterns(value: Option<&Value>) -> Result<Vec<String>> {
    let string = |value: &Value| match value {
        Value::String(pattern) => Ok(pattern.clone()),
        other => Err(anyhow!(
            "needs literal string patterns, not {}",
            other.kind()
        )),
    };
    match value {
        Some(Value::Array(items)) if !items.is_empty() => items.iter().map(string).collect(),
        Some(value @ Value::String(_)) => Ok(vec![string(value)?]),
        Some(other) => bail!(
            "needs a pattern or an array of patterns, not {}",
            other.kind()
        ),
        None => bail!("needs a pattern"),
    }
}

const GLOB: [char; 6] = ['*', '?', '[', '{', '(', '!'];

/// The files a pattern matches, skipping `node_modules` and dot-directories as Vite does.
fn matches(pattern: &str, importer: &Path, root: &Path) -> Result<Vec<PathBuf>> {
    let (mut directory, rest) = if let Some(rest) = pattern.strip_prefix('/') {
        (root.to_path_buf(), rest)
    } else if pattern.starts_with("./") || pattern.starts_with("../") {
        (importer.to_path_buf(), pattern)
    } else {
        bail!("pattern `{pattern}` must start with `./`, `../` or `/`; aliases are not supported");
    };
    let segments: Vec<&str> = rest.split('/').collect();
    let first = segments
        .iter()
        .position(|segment| segment.contains(GLOB))
        .unwrap_or(segments.len());
    for segment in &segments[..first] {
        match *segment {
            "" | "." => {}
            ".." => {
                directory.pop();
            }
            name => directory.push(name),
        }
    }
    if first == segments.len() {
        return Ok(if directory.is_file() {
            vec![directory]
        } else {
            vec![]
        });
    }
    let mut found = Vec::new();
    walk(&directory, "", &segments[first..].join("/"), &mut found);
    Ok(found.into_iter().map(|(path, _)| path).collect())
}

/// `file` relative to `directory`, `./`- or `../`-prefixed with `/` separators.
fn relative(file: &Path, directory: &Path) -> String {
    let file: Vec<Component> = file.components().collect();
    let directory: Vec<Component> = directory.components().collect();
    let common = file
        .iter()
        .zip(&directory)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts: Vec<String> = vec!["..".into(); directory.len() - common];
    parts.extend(
        file[common..]
            .iter()
            .map(|part| part.as_os_str().to_string_lossy().to_string()),
    );
    let joined = parts.join("/");
    if joined.starts_with("../") {
        joined
    } else {
        format!("./{joined}")
    }
}

/// One call's replacement, adding any static imports it needs to `imports`.
fn expand(
    values: &[Value],
    file: &Path,
    root: &Path,
    call: usize,
    imports: &mut String,
) -> Result<String> {
    if values.len() > 2 {
        bail!("takes a pattern and options only");
    }
    let patterns = patterns(values.first())?;
    let options = options(values.get(1))?;
    let importer = file.parent().ok_or_else(|| anyhow!("has no directory"))?;
    // Each file is keyed as the first pattern that matched it writes paths.
    let mut files: BTreeMap<PathBuf, bool> = BTreeMap::new();
    for pattern in patterns.iter().filter(|pattern| !pattern.starts_with('!')) {
        for file in matches(pattern, importer, root)? {
            files.entry(file).or_insert(pattern.starts_with('/'));
        }
    }
    for pattern in patterns
        .iter()
        .filter_map(|pattern| pattern.strip_prefix('!'))
    {
        for file in matches(pattern, importer, root)? {
            files.remove(&file);
        }
    }
    // As in Vite, a module never globs itself.
    files.remove(file);
    let mut members = Vec::with_capacity(files.len());
    for (index, (matched, from_root)) in files.iter().enumerate() {
        let key = if *from_root {
            format!("/{}", relative(matched, root).trim_start_matches("./"))
        } else {
            relative(matched, importer)
        };
        let specifier =
            serde_json::to_string(&format!("{}{}", relative(matched, importer), options.query))?;
        let value = match (&options.import, options.eager) {
            (Some(name), true) if name != "*" => {
                let local = format!("__specimen_glob_{call}_{index}");
                imports.push_str(&format!(
                    "import {{ {} as {local} }} from {specifier};\n",
                    serde_json::to_string(name)?
                ));
                local
            }
            (_, true) => {
                let local = format!("__specimen_glob_{call}_{index}");
                imports.push_str(&format!("import * as {local} from {specifier};\n"));
                local
            }
            (Some(name), false) if name != "*" => format!(
                "() => import({specifier}).then((module) => module[{}])",
                serde_json::to_string(name)?
            ),
            (_, false) => format!("() => import({specifier})"),
        };
        members.push(format!("{}: {value}", serde_json::to_string(&key)?));
    }
    Ok(format!("Object.assign({{{}}})", members.join(", ")))
}

/// The source with every `import.meta.glob` call expanded, or `None` when it has none.
pub fn import_globs(path: &str, source: &str, root: &Path) -> Result<Option<String>> {
    if !source.contains("import.meta.glob") {
        return Ok(None);
    }
    let Ok(source_type) = oxc::span::SourceType::from_path(path) else {
        return Ok(None);
    };
    let allocator = oxc::allocator::Allocator::default();
    // A source that does not parse is left to the bundler, which reports its error.
    let parsed = oxc::parser::Parser::new(&allocator, source, source_type).parse();
    let scope = Scope::new(&parsed.program);
    let mut calls = Calls {
        scope: &scope,
        found: Vec::new(),
    };
    calls.visit_program(&parsed.program);
    if calls.found.is_empty() {
        return Ok(None);
    }
    let mut imports = String::new();
    let mut out = String::with_capacity(source.len());
    let mut last = 0;
    for (call, (start, end, values)) in calls.found.iter().enumerate() {
        let replacement = expand(values, Path::new(path), root, call, &mut imports)
            .map_err(|error| anyhow!("import.meta.glob in {path} {error}"))?;
        out.push_str(&source[last..*start as usize]);
        out.push_str(&replacement);
        last = *end as usize;
    }
    out.push_str(&source[last..]);
    Ok(Some(format!("{imports}{out}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> PathBuf {
        let root = std::env::temp_dir().join(format!("specimen-glob-{}", uuid::Uuid::new_v4()));
        for file in [
            "src/main.ts",
            "src/a.ts",
            "src/nested/b.ts",
            "src/skip.ts",
            "src/node_modules/c.ts",
            "data.json",
        ] {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        root
    }

    #[test]
    fn expands_lazy_and_eager_calls_as_vite_writes_them() {
        let root = project();
        let importer = root.join("src/main.ts");
        let source = "const lazy = import.meta.glob(['./**/*.ts', '!./skip.ts']);\nconst urls = import.meta.glob<string>('../data.json', { eager: true, import: 'default', query: '?url' });\nconst rooted = import.meta.glob('/src/nested/*.ts', { import: 'setup' });\n";
        let out = import_globs(importer.to_str().unwrap(), source, &root)
            .unwrap()
            .unwrap();
        assert_eq!(
            out,
            "import { \"default\" as __specimen_glob_1_0 } from \"../data.json?url\";\nconst lazy = Object.assign({\"./a.ts\": () => import(\"./a.ts\"), \"./nested/b.ts\": () => import(\"./nested/b.ts\")});\nconst urls = Object.assign({\"../data.json\": __specimen_glob_1_0});\nconst rooted = Object.assign({\"/src/nested/b.ts\": () => import(\"./nested/b.ts\").then((module) => module[\"setup\"])});\n"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fails_on_what_it_cannot_read() {
        let root = project();
        let importer = root.join("src/main.ts");
        let path = importer.to_str().unwrap();
        for (source, message) in [
            (
                "import.meta.glob(pattern);",
                "needs a pattern or an array of patterns",
            ),
            (
                "import.meta.glob('./*.ts', { exhaustive: true });",
                "option `exhaustive`",
            ),
            ("import.meta.glob('@/x/*.ts');", "aliases are not supported"),
        ] {
            let error = import_globs(path, source, &root).unwrap_err().to_string();
            assert!(error.contains(message), "{error}");
        }
        assert_eq!(import_globs(path, "import.meta.url;", &root).unwrap(), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
