//! The preview-first codemod: for each retained story file, the native metadata it can gain
//! without changing what Storybook runs. It proposes a meta `component` only when the
//! custom elements manifest makes the choice unambiguous, keeps every existing field, and
//! reports the Storybook imports it leaves in place. Files change only when `apply` is set.

use super::index::{Specifier, bare, identifier_members, meta_object, walk};
use oxc::ast::ast::{Expression, ImportDeclarationSpecifier, ObjectExpression, Program, Statement};
use oxc::span::GetSpan;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct MigrateRequest {
    pub root: PathBuf,
    pub base: PathBuf,
    pub stories: Vec<Specifier>,
    /// The custom elements manifest, relative to `base`.
    pub manifest: Option<String>,
    /// Import paths to migrate; every discovered file when absent.
    pub files: Option<Vec<String>>,
    #[serde(default)]
    pub apply: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDecision {
    /// `present`: the meta names one; `proposed`: the codemod adds it; `manual`: a person must.
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    pub reason: String,
    /// Tags the manifest says the file's imports define.
    pub candidates: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperImport {
    pub source: String,
    pub names: Vec<String>,
    pub type_only: bool,
    /// Why the import stays as it is.
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMigration {
    pub import_path: String,
    pub component: ComponentDecision,
    /// Meta fields kept exactly as written: the codemod removes no metadata.
    pub retained: Vec<String>,
    pub imports: Vec<HelperImport>,
    pub manual: Vec<String>,
    /// The change as a unified diff; absent when there is none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    pub applied: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub files: usize,
    pub present: usize,
    pub proposed: usize,
    pub manual: usize,
    pub applied: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub mode: &'static str,
    pub files: Vec<FileMigration>,
    pub problems: Vec<String>,
    pub summary: Summary,
}

const EXTENSIONS: [&str; 6] = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

/// A path without `.` and `..` segments or a script extension: how modules are compared.
fn module_key(path: &Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                parts.pop();
            }
            Component::CurDir => {}
            Component::RootDir => parts.push(String::new()),
            other => parts.push(other.as_os_str().to_string_lossy().to_string()),
        }
    }
    let mut key = parts.join("/");
    for extension in EXTENSIONS {
        if let Some(stem) = key.strip_suffix(extension) {
            key = stem.to_string();
            break;
        }
    }
    key
}

/// Custom element tags by the module that declares them, from a manifest's `modules[].path`.
fn manifest_modules(path: &Path) -> Result<BTreeMap<String, Vec<String>>, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("{} cannot be read: {error}", path.display()))?;
    let manifest: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("{} is not JSON: {error}", path.display()))?;
    // Story files are compared by their real paths, so the manifest's directory is too.
    let directory = path.parent().unwrap_or(Path::new("."));
    let directory = std::fs::canonicalize(directory).unwrap_or_else(|_| directory.to_path_buf());
    let mut modules: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for module in manifest
        .get("modules")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
    {
        let Some(file) = module.get("path").and_then(|value| value.as_str()) else {
            continue;
        };
        let tags: Vec<String> = module
            .get("declarations")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|declaration| {
                declaration
                    .get("tagName")
                    .and_then(|value| value.as_str())
                    .map(String::from)
            })
            .collect();
        if !tags.is_empty() {
            modules
                .entry(module_key(&directory.join(file)))
                .or_default()
                .extend(tags);
        }
    }
    Ok(modules)
}

/// The meta object as `CsfFile` finds it.
fn find_meta<'p, 'a>(program: &'p Program<'a>) -> Option<&'p ObjectExpression<'a>> {
    for statement in &program.body {
        match statement {
            Statement::ExportDefaultDeclaration(export) => {
                let expression = export.declaration.as_expression()?;
                if let Expression::Identifier(identifier) = bare(expression) {
                    let name = identifier.name.as_str();
                    for statement in &program.body {
                        if let Statement::VariableDeclaration(variables) = statement
                            && let Some(declarator) = variables
                                .declarations
                                .iter()
                                .find(|d| d.id.get_identifier_name().is_some_and(|id| id == name))
                        {
                            return declarator.init.as_ref().and_then(meta_object);
                        }
                    }
                    return None;
                }
                return meta_object(expression);
            }
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    if specifier.exported.name() == "default" {
                        return super::index::var_initialization(&specifier.local.name(), program)
                            .and_then(meta_object);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// The leading whitespace of the line `offset` is on, and whether only whitespace precedes it.
fn line_indent(source: &str, offset: usize) -> (String, bool) {
    let start = source[..offset].rfind('\n').map_or(0, |index| index + 1);
    let before = &source[start..offset];
    let indent: String = before
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect();
    (indent.clone(), before.len() == indent.len())
}

/// A unified diff of one change, with two lines of context.
fn diff(path: &str, before: &str, after: &str) -> String {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let start = prefix.saturating_sub(2);
    let old_end = (old.len() - suffix + 2).min(old.len());
    let new_end = (new.len() - suffix + 2).min(new.len());
    let mut text = format!(
        "--- {path}\n+++ {path}\n@@ -{},{} +{},{} @@\n",
        start + 1,
        old_end - start,
        start + 1,
        new_end - start
    );
    for line in &old[start..prefix] {
        text.push_str(&format!(" {line}\n"));
    }
    for line in &old[prefix..old.len() - suffix] {
        text.push_str(&format!("-{line}\n"));
    }
    for line in &new[prefix..new.len() - suffix] {
        text.push_str(&format!("+{line}\n"));
    }
    for line in &old[old.len() - suffix..old_end] {
        text.push_str(&format!(" {line}\n"));
    }
    text
}

fn helper_imports(program: &Program) -> Vec<HelperImport> {
    program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import) => {
                let source = import.source.value.display().to_string();
                if source != "storybook/test" && !source.starts_with("@storybook/") {
                    return None;
                }
                let names = import
                    .specifiers
                    .iter()
                    .flatten()
                    .map(|specifier| match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(item) => item.imported.name().to_string(),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => "default".into(),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => "*".into(),
                    })
                    .collect();
                let type_only = import.import_kind.is_type();
                Some(HelperImport {
                    reason: if source == "storybook/test" {
                        "Kept: the play helpers have no native replacement yet; Storybook stays installed during the overlap".into()
                    } else if type_only {
                        "Kept: Specimen has no native `Meta`/`Specimen` types yet".into()
                    } else {
                        "Kept: a framework import the preview or story still needs".into()
                    },
                    source,
                    names,
                    type_only,
                })
            }
            _ => None,
        })
        .collect()
}

/// One file's migration; `None` with a problem when the file cannot be read as CSF.
fn migrate_file(
    path: &Path,
    import_path: &str,
    modules: Option<&BTreeMap<String, Vec<String>>>,
    apply: bool,
) -> Result<FileMigration, String> {
    let source = std::fs::read_to_string(path)
        .map_err(|error| format!("{import_path} cannot be read: {error}"))?;
    let allocator = oxc::allocator::Allocator::default();
    let source_type = oxc::span::SourceType::from_path(path)
        .map_err(|_| format!("{import_path} is not a script"))?;
    let parsed = oxc::parser::Parser::new(&allocator, &source, source_type).parse();
    if let Some(error) = parsed.diagnostics.errors().next() {
        return Err(format!("{import_path} does not parse: {error}"));
    }
    let program = &parsed.program;
    let meta = find_meta(program)
        .ok_or_else(|| format!("{import_path}: the meta is not a statically readable object"))?;
    let members = identifier_members(meta);
    let retained: Vec<String> = members.iter().map(|(key, _)| key.to_string()).collect();
    let imports = helper_imports(program);
    let directory = path.parent().unwrap_or(Path::new("."));
    let mut candidates = BTreeSet::new();
    if let Some(modules) = modules {
        for statement in &program.body {
            if let Statement::ImportDeclaration(import) = statement {
                if import.import_kind.is_type() {
                    continue;
                }
                let specifier = import.source.value.display().to_string();
                if !specifier.starts_with('.') {
                    continue;
                }
                let target = directory.join(&specifier);
                for key in [module_key(&target), module_key(&target.join("index"))] {
                    if let Some(tags) = modules.get(&key) {
                        candidates.extend(tags.iter().cloned());
                    }
                }
            }
        }
    }
    let candidates: Vec<String> = candidates.into_iter().collect();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let named = file_name
        .split(".stories.")
        .next()
        .unwrap_or(&file_name)
        .to_string();
    let mut manual = Vec::new();
    let existing = members.iter().find(|(key, _)| *key == "component");
    let component = if let Some((_, value)) = existing {
        let literal = value.and_then(|value| match bare(value) {
            Expression::StringLiteral(literal) => Some(literal.value.display().to_string()),
            _ => None,
        });
        ComponentDecision {
            status: "present",
            reason: match &literal {
                Some(_) => "The meta names its component".into(),
                None => "The meta names its component with an expression the codemod does not read"
                    .into(),
            },
            tag: literal,
            candidates: candidates.clone(),
        }
    } else if modules.is_none() {
        manual.push("Name the meta's `component`: no custom elements manifest is configured to infer it from.".into());
        ComponentDecision {
            status: "manual",
            tag: None,
            reason: "No manifest is configured".into(),
            candidates,
        }
    } else if candidates.contains(&named) {
        ComponentDecision {
            status: "proposed",
            tag: Some(named.clone()),
            reason: format!(
                "The file imports the module the manifest says defines `{named}`, and is named for it"
            ),
            candidates: candidates.clone(),
        }
    } else {
        let reason = if candidates.is_empty() {
            "No imported module defines a custom element the manifest knows".to_string()
        } else {
            format!(
                "The imports define {}, and the file is named `{named}`: the described component is ambiguous",
                candidates
                    .iter()
                    .map(|tag| format!("`{tag}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        manual.push(format!("Name the meta's `component`. {reason}."));
        ComponentDecision {
            status: "manual",
            tag: None,
            reason,
            candidates: candidates.clone(),
        }
    };
    let mut diff_text = None;
    let mut applied = false;
    if component.status == "proposed"
        && let Some(tag) = &component.tag
    {
        // Matches the file's quote style, read from the title's literal.
        let quote = members
            .iter()
            .find(|(key, _)| *key == "title")
            .and_then(|(_, value)| value.map(|value| value.span()))
            .and_then(|span| source[span.start as usize..].chars().next())
            .filter(|c| *c == '"' || *c == '\'')
            .unwrap_or('\'');
        let offset = meta
            .properties
            .first()
            .map_or(meta.span.start as usize + 1, |property| {
                property.span().start as usize
            });
        let (indent, own_line) = line_indent(&source, offset);
        let insertion = if own_line && !meta.properties.is_empty() {
            format!("component: {quote}{tag}{quote},\n{indent}")
        } else {
            format!("component: {quote}{tag}{quote}, ")
        };
        let after = format!("{}{insertion}{}", &source[..offset], &source[offset..]);
        diff_text = Some(diff(import_path, &source, &after));
        if apply {
            // Written only if the file is still what was read.
            if std::fs::read_to_string(path).ok().as_deref() != Some(source.as_str()) {
                return Err(format!(
                    "{import_path} changed while it was being migrated; nothing was written"
                ));
            }
            let temporary = path.with_extension(format!("specimen-migrate-{}", std::process::id()));
            std::fs::write(&temporary, &after)
                .map_err(|error| format!("{import_path} cannot be written: {error}"))?;
            std::fs::rename(&temporary, path)
                .map_err(|error| format!("{import_path} cannot be replaced: {error}"))?;
            applied = true;
        }
    }
    Ok(FileMigration {
        import_path: import_path.to_string(),
        component,
        retained,
        imports,
        manual,
        diff: diff_text,
        applied,
    })
}

pub fn migrate(request: &MigrateRequest) -> Migration {
    let root = std::fs::canonicalize(&request.root).unwrap_or_else(|_| request.root.clone());
    let mut problems = Vec::new();
    let modules = match &request.manifest {
        Some(manifest) => match manifest_modules(&request.base.join(manifest)) {
            Ok(modules) => Some(modules),
            Err(problem) => {
                problems.push(problem);
                None
            }
        },
        None => None,
    };
    let wanted: Option<BTreeSet<&str>> = request
        .files
        .as_ref()
        .map(|files| files.iter().map(String::as_str).collect());
    let mut files = Vec::new();
    let mut seen = BTreeSet::new();
    for specifier in &request.stories {
        let directory = request.base.join(&specifier.directory);
        let directory = std::fs::canonicalize(&directory).unwrap_or(directory);
        let mut found = Vec::new();
        walk(&directory, "", &specifier.files, &mut found);
        for (path, _) in found {
            let path = std::fs::canonicalize(&path).unwrap_or(path);
            let Some(import) = super::index::import_path(&root, &path) else {
                problems.push(format!("{} is outside the bench root", path.display()));
                continue;
            };
            if !seen.insert(import.clone())
                || wanted
                    .as_ref()
                    .is_some_and(|wanted| !wanted.contains(import.as_str()))
            {
                continue;
            }
            match migrate_file(&path, &import, modules.as_ref(), request.apply) {
                Ok(migration) => files.push(migration),
                Err(problem) => problems.push(problem),
            }
        }
    }
    if let Some(wanted) = &wanted {
        for file in wanted {
            if !seen.contains(*file) {
                problems.push(format!(
                    "{file} is not a story file the stories specifiers discover"
                ));
            }
        }
    }
    let summary = Summary {
        files: files.len(),
        present: files
            .iter()
            .filter(|file| file.component.status == "present")
            .count(),
        proposed: files
            .iter()
            .filter(|file| file.component.status == "proposed")
            .count(),
        manual: files
            .iter()
            .filter(|file| file.component.status == "manual")
            .count(),
        applied: files.iter().filter(|file| file.applied).count(),
    };
    Migration {
        mode: if request.apply { "apply" } else { "preview" },
        files,
        problems,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("specimen-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        for (file, text) in files {
            let path = directory.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        directory
    }

    const MANIFEST: &str = r#"{ "modules": [
        { "path": "src/x-button.ts", "declarations": [{ "tagName": "x-button" }] },
        { "path": "src/x-icon.ts", "declarations": [{ "tagName": "x-icon" }] }
    ] }"#;

    fn run(directory: &Path, apply: bool) -> Migration {
        migrate(&MigrateRequest {
            root: directory.to_path_buf(),
            base: directory.to_path_buf(),
            stories: vec![Specifier {
                directory: "src".into(),
                files: "**/*.stories.ts".into(),
                title_prefix: String::new(),
            }],
            manifest: Some("custom-elements.json".into()),
            files: None,
            apply,
        })
    }

    #[test]
    fn proposes_only_an_unambiguous_component_and_keeps_every_field() {
        let directory = fixture(
            "propose",
            &[
                ("custom-elements.json", MANIFEST),
                ("src/x-button.ts", ""),
                ("src/x-icon.ts", ""),
                (
                    "src/x-button.stories.ts",
                    "import { expect } from \"storybook/test\";\nimport \"./x-icon.js\";\nimport \"./x-button.js\";\n\nexport default {\n  title: \"Components/Button\",\n  tags: [\"autodocs\"],\n  parameters: { docs: { description: { component: \"A button.\" } } },\n};\nexport const Primary = {};\n",
                ),
                (
                    "src/composite.stories.ts",
                    "import './x-icon.js';\nimport './x-button.js';\nexport default { title: 'Composite' };\nexport const Primary = {};\n",
                ),
                (
                    "src/named.stories.ts",
                    "export default { title: 'Named', component: 'x-button' };\nexport const Primary = {};\n",
                ),
            ],
        );
        let preview = run(&directory, false);
        assert!(preview.problems.is_empty(), "{:?}", preview.problems);
        let by_file = |name: &str| {
            preview
                .files
                .iter()
                .find(|file| file.import_path.ends_with(name))
                .unwrap()
        };
        let button = by_file("x-button.stories.ts");
        assert_eq!(button.component.status, "proposed");
        assert_eq!(button.retained, ["title", "tags", "parameters"]);
        assert_eq!(button.imports[0].source, "storybook/test");
        let diff = button.diff.as_deref().unwrap();
        assert!(
            diff.contains("+  component: \"x-button\",\n   title: \"Components/Button\","),
            "{diff}"
        );
        let composite = by_file("composite.stories.ts");
        assert_eq!(composite.component.status, "manual");
        assert_eq!(composite.component.candidates, ["x-button", "x-icon"]);
        assert_eq!(by_file("named.stories.ts").component.status, "present");
        assert_eq!(preview.summary.applied, 0);
        // Preview wrote nothing; apply writes the proposal and nothing else.
        let original = std::fs::read_to_string(directory.join("src/x-button.stories.ts")).unwrap();
        assert!(!original.contains("component: \"x-button\""));
        let applied = run(&directory, true);
        assert_eq!(applied.summary.applied, 1);
        let written = std::fs::read_to_string(directory.join("src/x-button.stories.ts")).unwrap();
        assert_eq!(
            written,
            original.replacen("  title:", "  component: \"x-button\",\n  title:", 1)
        );
        // Applying again finds the component present and changes nothing.
        assert_eq!(run(&directory, true).summary.applied, 0);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn inserts_inline_into_a_one_line_meta() {
        let directory = fixture(
            "inline",
            &[
                ("custom-elements.json", MANIFEST),
                ("src/x-button.ts", ""),
                (
                    "src/x-button.stories.ts",
                    "import './x-button.js';\nconst meta = { title: 'B' };\nexport default meta;\nexport const A = {};\n",
                ),
            ],
        );
        let migration = run(&directory, true);
        assert_eq!(migration.summary.applied, 1);
        let written = std::fs::read_to_string(directory.join("src/x-button.stories.ts")).unwrap();
        assert!(
            written.contains("const meta = { component: 'x-button', title: 'B' };"),
            "{written}"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }
}
