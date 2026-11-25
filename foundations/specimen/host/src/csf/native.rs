//! Static extraction of `patternSetup` and `contexts` from native specimen modules (`spec.md` §4.1).

use super::index::{bare, value_to_json};
use super::value::{Field, Scope, Value};
use oxc::allocator::Allocator;
use oxc::ast::ast::{Declaration, Expression, Program, Statement};
use oxc::parser::Parser;
use oxc::span::SourceType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBindingTarget {
    pub id: String,
    pub file: PathBuf,
    pub export_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBindingsRequest {
    pub entries: Vec<NativeBindingTarget>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBinding {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_setup: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contexts: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBindingsResult {
    pub bindings: Vec<NativeBinding>,
}

/// Unwrap transparent wrappers (`as T`, `satisfies T`, `defineSpecimen({...})`, `Object.freeze({...})`)
/// before evaluating a native specimen export statically.
fn unwrap_definition<'e, 'a>(expr: &'e Expression<'a>) -> &'e Expression<'a> {
    let mut current = bare(expr);
    loop {
        match current {
            Expression::TSAsExpression(outer) => current = bare(&outer.expression),
            Expression::TSSatisfiesExpression(outer) => current = bare(&outer.expression),
            Expression::CallExpression(call) if call.arguments.len() == 1 => {
                if let Some(arg) = call.arguments[0].as_expression() {
                    current = bare(arg);
                } else {
                    break;
                }
            }
            _ => break,
        }
    }
    current
}

fn find_export_expression<'p, 'a>(
    program: &'p Program<'a>,
    export_name: &str,
) -> Option<&'p Expression<'a>> {
    if export_name == "default" {
        return program.body.iter().find_map(|statement| match statement {
            Statement::ExportDefaultDeclaration(export) => export.declaration.as_expression(),
            _ => None,
        });
    }
    let mut alias_local: Option<&str> = None;
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(vars) = &export.declaration {
                    for decl in &vars.declarations {
                        if decl
                            .id
                            .get_identifier_name()
                            .is_some_and(|name| name == export_name)
                        {
                            return decl.init.as_ref();
                        }
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                for spec in &export.specifiers {
                    if spec.exported.name().as_str() == export_name {
                        alias_local = Some(spec.local.name().as_str());
                    }
                }
            }
            _ => {}
        }
    }
    let local_name = alias_local?;
    for statement in &program.body {
        if let Statement::VariableDeclaration(vars) = statement {
            for decl in &vars.declarations {
                if decl
                    .id
                    .get_identifier_name()
                    .is_some_and(|name| name == local_name)
                {
                    return decl.init.as_ref();
                }
            }
        }
    }
    None
}

fn read_field_json(value: &Value, field: &str) -> Option<serde_json::Value> {
    let Value::Object(object) = value else {
        return None;
    };
    let Field::Set(field_value) = object.get(field) else {
        return None;
    };
    value_to_json(field_value)
}

fn extract_from_source(
    path: &Path,
    source: &str,
    targets: &[&NativeBindingTarget],
) -> Vec<NativeBinding> {
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::mjs());
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.diagnostics.errors().next().is_some() {
        return Vec::new();
    }
    let program = &parsed.program;
    let scope = Scope::new(program);

    let mut out = Vec::new();
    for target in targets {
        let Some(expr) = find_export_expression(program, &target.export_name) else {
            continue;
        };
        let evaluated = scope.evaluate(unwrap_definition(expr));
        let pattern_setup = read_field_json(&evaluated, "patternSetup");
        let contexts = read_field_json(&evaluated, "contexts");
        if pattern_setup.is_some() || contexts.is_some() {
            out.push(NativeBinding {
                id: target.id.clone(),
                pattern_setup,
                contexts,
            });
        }
    }
    out
}

pub fn extract_native_bindings(request: &NativeBindingsRequest) -> NativeBindingsResult {
    let mut by_file: HashMap<&Path, Vec<&NativeBindingTarget>> = HashMap::new();
    for target in &request.entries {
        by_file
            .entry(target.file.as_path())
            .or_default()
            .push(target);
    }
    let mut bindings = Vec::new();
    for (path, targets) in by_file {
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        bindings.extend(extract_from_source(path, &source, &targets));
    }
    NativeBindingsResult { bindings }
}

#[cfg(test)]
mod tests {
    use super::{NativeBindingTarget, extract_from_source};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn reads_pattern_setup_and_contexts_from_plain_wrapped_and_aliased_exports() {
        let source = r#"
            const sharedBinding = { pattern: 'select', setup: 'three-options' } as const;
            export default {
                component: 'example-select',
            };
            export const Plain = {
                patternSetup: sharedBinding,
                contexts: { themes: ['light'], reason: 'Light theme default' },
                render: () => document.createElement('example-select'),
            };
            export const Wrapped = defineSpecimen({
                patternSetup: { library: 'example', pattern: 'select', setup: 'one-chosen' },
                contexts: { viewport: { minWidth: 640 }, reason: 'Desktop only' },
                render: () => document.createElement('example-select'),
            });
            const localCase = {
                patternSetup: { pattern: 'field', setup: 'default' },
            };
            export { localCase as Aliased };
        "#;
        let path = PathBuf::from("select.specimens.ts");
        let t1 = NativeBindingTarget {
            id: "plain".into(),
            file: path.clone(),
            export_name: "Plain".into(),
        };
        let t2 = NativeBindingTarget {
            id: "wrapped".into(),
            file: path.clone(),
            export_name: "Wrapped".into(),
        };
        let t3 = NativeBindingTarget {
            id: "aliased".into(),
            file: path.clone(),
            export_name: "Aliased".into(),
        };
        let found = extract_from_source(&path, source, &[&t1, &t2, &t3]);
        assert_eq!(found.len(), 3);
        assert_eq!(
            found[0].pattern_setup,
            Some(json!({ "pattern": "select", "setup": "three-options" }))
        );
        assert_eq!(
            found[0].contexts,
            Some(json!({ "themes": ["light"], "reason": "Light theme default" }))
        );
        assert_eq!(
            found[1].pattern_setup,
            Some(json!({ "library": "example", "pattern": "select", "setup": "one-chosen" }))
        );
        assert_eq!(
            found[1].contexts,
            Some(json!({ "viewport": { "minWidth": 640 }, "reason": "Desktop only" }))
        );
        assert_eq!(
            found[2].pattern_setup,
            Some(json!({ "pattern": "field", "setup": "default" }))
        );
    }
}
