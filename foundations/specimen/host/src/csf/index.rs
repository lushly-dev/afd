//! Discovery: the stories a set of stories specifiers names, with the ids, titles, names and
//! tags Storybook's index gives them. It follows Storybook 10.6.2's `CsfFile` and story index
//! generator rule for rule, which read annotations syntactically: a story's `name` counts only
//! as a string literal written on the story object, and spreads are not followed. What the
//! story will actually do at runtime is reported separately, from a static evaluation that
//! follows spreads and references and marks what it cannot read as unresolved.

use super::identity::{self, Selector};
use super::value::{Field, Scope, Value};
use oxc::ast::ast::{
    Declaration, Expression, ObjectExpression, ObjectPropertyKind, Program, PropertyKey, Statement,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Storybook's normalized stories specifier: files matching `files` under `directory`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Specifier {
    pub directory: String,
    pub files: String,
    #[serde(default)]
    pub title_prefix: String,
}

#[derive(Debug, Deserialize)]
pub struct IndexRequest {
    /// The bench root: files must be inside it, and import paths are relative to it.
    pub root: PathBuf,
    /// The directory specifiers and the preview path are relative to.
    pub base: PathBuf,
    pub stories: Vec<Specifier>,
    /// The project annotations module, read for its tags.
    pub preview: Option<String>,
}

/// Whether a story has a play function: set, absent, or not readable statically.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unresolved {
    pub level: &'static str,
    pub field: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub name: String,
    pub import_path: String,
    pub export_name: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    pub play: Presence,
    /// Fields the meta or story sets whose value cannot be read statically.
    pub unresolved: Vec<Unresolved>,
    /// Annotation fields set at each level; `*` when a level may set fields that cannot be read.
    pub annotations: Annotations,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Annotations {
    pub meta: Vec<String>,
    pub story: Vec<String>,
}

/// The fields an evaluated annotations object sets.
fn field_names(value: &Value) -> Vec<String> {
    match value {
        Value::Object(object) => {
            let mut names: Vec<String> =
                object.fields.iter().map(|(name, _)| name.clone()).collect();
            if object.open.is_some() {
                names.push("*".into());
            }
            names
        }
        Value::Function => vec!["render".into()],
        _ => vec!["*".into()],
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_name: Option<String>,
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub entries: Vec<Entry>,
    /// Storybook's default project tags and the preview's own.
    pub project_tags: Vec<String>,
    /// The fields the project annotations set, read statically; `*` when not all are readable.
    pub project_annotations: Vec<String>,
    /// Discovery failures: a file, story or identity that cannot be indexed.
    pub errors: Vec<Problem>,
    /// What Storybook would accept with only a warning.
    pub warnings: Vec<Problem>,
    /// Every file read, so a change to any of them invalidates the index.
    pub files: Vec<String>,
}

const DEFAULT_TAGS: [&str; 3] = ["dev", "test", "manifest"];

/// Babel does not represent parentheses; oxc keeps them.
fn bare<'e, 'a>(expression: &'e Expression<'a>) -> &'e Expression<'a> {
    expression.without_parentheses()
}

/// A meta node as `CsfFile` accepts it: an object, `{...} as T`, `{...} satisfies T`, or
/// `{...} satisfies M as T`.
fn meta_object<'e, 'a>(expression: &'e Expression<'a>) -> Option<&'e ObjectExpression<'a>> {
    match bare(expression) {
        Expression::ObjectExpression(object) => Some(object),
        Expression::TSAsExpression(outer) => match bare(&outer.expression) {
            Expression::ObjectExpression(object) => Some(object),
            Expression::TSSatisfiesExpression(inner) => match bare(&inner.expression) {
                Expression::ObjectExpression(object) => Some(object),
                _ => None,
            },
            _ => None,
        },
        Expression::TSSatisfiesExpression(outer) => match bare(&outer.expression) {
            Expression::ObjectExpression(object) => Some(object),
            _ => None,
        },
        _ => None,
    }
}

/// A story declarator's node: one `as` or `satisfies`, or `satisfies` inside `as`, removed.
fn story_node<'e, 'a>(init: &'e Expression<'a>) -> &'e Expression<'a> {
    match bare(init) {
        Expression::TSAsExpression(outer) => match bare(&outer.expression) {
            Expression::TSSatisfiesExpression(inner) => bare(&inner.expression),
            other => other,
        },
        Expression::TSSatisfiesExpression(outer) => bare(&outer.expression),
        other => other,
    }
}

/// `findVarInitialization`: the initializer of a top-level, possibly exported, `var`/`let`/`const`.
fn var_initialization<'p, 'a>(name: &str, program: &'p Program<'a>) -> Option<&'p Expression<'a>> {
    for statement in &program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => &export.declaration,
            Statement::VariableDeclaration(_) => match statement.as_declaration() {
                Some(declaration) => declaration,
                None => continue,
            },
            _ => continue,
        };
        if let Declaration::VariableDeclaration(variables) = declaration {
            for declarator in &variables.declarations {
                if declarator
                    .id
                    .get_identifier_name()
                    .is_some_and(|id| id == name)
                {
                    return declarator.init.as_ref();
                }
            }
        }
    }
    None
}

/// An object literal's identifier-keyed members, as `CsfFile` records annotations.
fn identifier_members<'e, 'a>(
    object: &'e ObjectExpression<'a>,
) -> Vec<(&'e str, Option<&'e Expression<'a>>)> {
    object
        .properties
        .iter()
        .filter_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                match &property.key {
                    PropertyKey::StaticIdentifier(key) => Some((
                        key.name.as_str(),
                        // A method is recorded as itself; only its presence matters here.
                        if property.method {
                            None
                        } else {
                            Some(&property.value)
                        },
                    )),
                    _ => None,
                }
            }
            _ => None,
        })
        .collect()
}

fn string_literal(expression: &Expression) -> Option<String> {
    match bare(expression) {
        Expression::StringLiteral(literal) => Some(literal.value.display().to_string()),
        _ => None,
    }
}

/// `parseTags`: an array of string literals, or an error.
fn parse_tags(expression: Option<&Expression>) -> Result<Vec<String>, String> {
    let Some(Expression::ArrayExpression(array)) = expression.map(bare) else {
        return Err("CSF: Expected tags array".into());
    };
    array
        .elements
        .iter()
        .map(|element| {
            element
                .as_expression()
                .and_then(string_literal)
                .ok_or_else(|| "CSF: Expected tag to be string literal".to_string())
        })
        .collect()
}

/// A tags annotation: an identifier names a top-level variable's initializer.
fn tags_of<'a>(
    expression: Option<&Expression<'a>>,
    program: &Program<'a>,
) -> Result<Vec<String>, String> {
    match expression.map(bare) {
        Some(Expression::Identifier(identifier)) => {
            parse_tags(var_initialization(identifier.name.as_str(), program))
        }
        other => parse_tags(other),
    }
}

/// `parseIncludeExclude`.
fn selector(expression: &Expression) -> Result<Selector, String> {
    match bare(expression) {
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .map(|element| {
                element
                    .as_expression()
                    .and_then(string_literal)
                    .ok_or_else(|| "Expected string literal in includeStories/excludeStories".to_string())
            })
            .collect::<Result<_, _>>()
            .map(Selector::Names),
        Expression::StringLiteral(literal) => Selector::pattern(&literal.value.display().to_string(), ""),
        Expression::RegExpLiteral(literal) => {
            Selector::pattern(literal.regex.pattern.text.as_str(), &literal.regex.flags.to_string())
        }
        _ => Err("Unknown include/exclude: expected an array of strings, a string or a regular expression".into()),
    }
}

#[derive(Default)]
struct Meta {
    title: Option<String>,
    id: Option<String>,
    tags: Option<Vec<String>>,
    include: Option<Selector>,
    exclude: Option<Selector>,
    component: Option<String>,
    play: bool,
}

/// `_parseMeta`.
fn parse_meta<'a>(object: &ObjectExpression<'a>, program: &Program<'a>) -> Result<Meta, String> {
    let mut meta = Meta::default();
    for (key, value) in identifier_members(object) {
        match (key, value) {
            ("title", Some(value)) => {
                let node = match bare(value) {
                    Expression::Identifier(identifier) => {
                        var_initialization(identifier.name.as_str(), program)
                    }
                    other => Some(other),
                };
                let title = match node.map(bare) {
                    Some(Expression::StringLiteral(literal)) => {
                        Some(literal.value.display().to_string())
                    }
                    Some(Expression::TSSatisfiesExpression(satisfies)) => {
                        string_literal(&satisfies.expression)
                    }
                    _ => None,
                };
                meta.title =
                    Some(title.ok_or(
                        "CSF: unexpected dynamic title; the title must be a string literal",
                    )?);
            }
            ("includeStories", Some(value)) => meta.include = Some(selector(value)?),
            ("excludeStories", Some(value)) => meta.exclude = Some(selector(value)?),
            ("component", Some(value)) => meta.component = string_literal(value),
            ("tags", value) => meta.tags = Some(tags_of(value, program)?),
            ("id", Some(value)) => {
                meta.id = Some(
                    string_literal(value)
                        .ok_or("Unexpected component id: it must be a string literal")?,
                );
            }
            ("play", _) => meta.play = true,
            _ => {}
        }
    }
    Ok(meta)
}

/// One story as `CsfFile` records it.
struct Story<'p, 'a> {
    export_name: String,
    /// The module-level binding the export names.
    local: String,
    name: String,
    explicit_id: Option<String>,
    /// Identifier-keyed annotations: `None` for a method.
    annotations: Vec<(String, Option<&'p Expression<'a>>)>,
}

impl<'p, 'a> Story<'p, 'a> {
    fn annotation(&self, key: &str) -> Option<Option<&'p Expression<'a>>> {
        self.annotations
            .iter()
            .rev()
            .find(|(name, _)| name == key)
            .map(|(_, value)| *value)
    }

    fn annotate(&mut self, key: &str, value: Option<&'p Expression<'a>>) {
        self.annotations.push((key.to_string(), value));
    }
}

/// What reading one file gives: its title, entries and problems.
struct FileIndex {
    entries: Vec<Entry>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

/// One story file, read as Storybook's `CsfFile.parse` and `extractStories` read it.
fn index_file(
    source: &str,
    path: &str,
    import_path: &str,
    relative_path: &str,
    specifier: &Specifier,
    project_tags: &[String],
) -> FileIndex {
    let mut result = FileIndex {
        entries: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };
    let allocator = oxc::allocator::Allocator::default();
    let Ok(source_type) = oxc::span::SourceType::from_path(path) else {
        result.errors.push(format!(
            "{import_path} is not a JavaScript or TypeScript file"
        ));
        return result;
    };
    let parsed = oxc::parser::Parser::new(&allocator, source, source_type).parse();
    if let Some(error) = parsed.diagnostics.errors().next() {
        result
            .errors
            .push(format!("{import_path} does not parse: {error}"));
        return result;
    }
    let program = &parsed.program;
    match read_stories(program) {
        Ok((meta, stories, order)) => {
            let scope = Scope::new(program);
            if let Err(error) = entries(
                &mut result,
                &scope,
                program,
                meta,
                stories,
                order,
                import_path,
                relative_path,
                specifier,
                project_tags,
            ) {
                result.errors.push(error);
            }
        }
        Err(error) => result.errors.push(error),
    }
    result
}

type Read<'p, 'a> = (Meta, Vec<Story<'p, 'a>>, Option<Vec<String>>);

fn read_stories<'p, 'a>(program: &'p Program<'a>) -> Result<Read<'p, 'a>, String> {
    let mut meta: Option<Meta> = None;
    let mut stories: Vec<Story> = Vec::new();
    let mut order: Option<Vec<String>> = None;
    let set_meta = |meta: &mut Option<Meta>, object: &ObjectExpression<'a>| -> Result<(), String> {
        if meta.is_some() {
            return Err("CSF: multiple meta objects".into());
        }
        *meta = Some(parse_meta(object, program)?);
        Ok(())
    };
    let new_story = |stories: &mut Vec<Story<'p, 'a>>, story: Story<'p, 'a>| {
        // A repeated export keeps its first position, as an object key does.
        match stories
            .iter()
            .position(|existing| existing.export_name == story.export_name)
        {
            Some(position) => stories[position] = story,
            None => stories.push(story),
        }
    };
    for statement in &program.body {
        match statement {
            Statement::ExportDefaultDeclaration(export) => {
                let declaration = export.declaration.as_expression();
                let (statement_found, decl) = match declaration.map(bare) {
                    Some(Expression::Identifier(identifier)) => {
                        // Only an unexported top-level `const`/`let`/`var` statement counts here.
                        let name = identifier.name.as_str();
                        let mut found = (false, None);
                        for statement in &program.body {
                            if let Statement::VariableDeclaration(variables) = statement
                                && let Some(declarator) = variables.declarations.iter().find(|d| {
                                    d.id.get_identifier_name().is_some_and(|id| id == name)
                                })
                            {
                                found = (true, declarator.init.as_ref());
                                break;
                            }
                        }
                        found
                    }
                    other => (true, other),
                };
                match decl.and_then(meta_object) {
                    Some(object) => set_meta(&mut meta, object)?,
                    None if statement_found => {
                        return Err("CSF: default export must be an object".into());
                    }
                    None => {}
                }
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(variables) => {
                    for declarator in &variables.declarations {
                        let Some(export_name) = declarator.id.get_identifier_name() else {
                            continue;
                        };
                        let export_name = export_name.to_string();
                        if export_name == "__namedExportsOrder" {
                            order = Some(match declarator.init.as_ref().map(bare) {
                                Some(Expression::ArrayExpression(array)) => array
                                    .elements
                                    .iter()
                                    .map(|element| element.as_expression().and_then(string_literal).ok_or_else(|| "Expected string literal named export in __namedExportsOrder".to_string()))
                                    .collect::<Result<_, _>>()?,
                                _ => return Err("Expected array of string literals in __namedExportsOrder".into()),
                            });
                            continue;
                        }
                        let node = declarator.init.as_ref().map(story_node);
                        if let Some(Expression::CallExpression(call)) = node
                            && let Expression::StaticMemberExpression(member) = bare(&call.callee)
                            && matches!(member.property.name.as_str(), "story" | "extend")
                        {
                            return Err(format!(
                                "{export_name}: CSF factory stories are not supported"
                            ));
                        }
                        let mut story = Story {
                            name: identity::story_name_from_export(&export_name),
                            local: export_name.clone(),
                            export_name,
                            explicit_id: None,
                            annotations: Vec::new(),
                        };
                        if let Some(Expression::ObjectExpression(object)) = node {
                            for (key, value) in identifier_members(object) {
                                if let Some(value) = value {
                                    if key == "name"
                                        && let Some(name) = string_literal(value)
                                    {
                                        story.name = name;
                                    } else if key == "parameters"
                                        && let Expression::ObjectExpression(parameters) =
                                            bare(value)
                                        && let Some((_, Some(id))) = identifier_members(parameters)
                                            .into_iter()
                                            .find(|(key, _)| *key == "__id")
                                    {
                                        story.explicit_id = string_literal(id);
                                    }
                                }
                                story.annotate(key, value);
                            }
                        }
                        new_story(&mut stories, story);
                    }
                }
                Declaration::FunctionDeclaration(function) => {
                    if let Some(identifier) = &function.id {
                        let export_name = identifier.name.to_string();
                        new_story(
                            &mut stories,
                            Story {
                                name: identity::story_name_from_export(&export_name),
                                local: export_name.clone(),
                                export_name,
                                explicit_id: None,
                                annotations: Vec::new(),
                            },
                        );
                    }
                }
                _ => {}
            },
            Statement::ExportNamedDeclaration(export) => {
                if export.export_kind.is_type() {
                    continue;
                }
                for specifier in &export.specifiers {
                    if specifier.export_kind.is_type() {
                        continue;
                    }
                    let export_name = specifier.exported.name().to_string();
                    let decl = var_initialization(&specifier.local.name(), program);
                    if export_name == "default" {
                        if let Some(object) = decl.and_then(meta_object) {
                            set_meta(&mut meta, object)?;
                        }
                        continue;
                    }
                    // Stories exported through a specifier keep their export name as written.
                    let mut story = Story {
                        name: export_name.clone(),
                        local: specifier.local.name().to_string(),
                        export_name,
                        explicit_id: None,
                        annotations: Vec::new(),
                    };
                    if let Some(Expression::ObjectExpression(object)) = decl.map(bare) {
                        for (key, value) in identifier_members(object) {
                            story.annotate(key, value);
                        }
                    }
                    new_story(&mut stories, story);
                }
            }
            Statement::ExportFromDeclaration(export) => {
                return Err(format!(
                    "stories re-exported from '{}' are not supported",
                    export.source.value.display()
                ));
            }
            Statement::ExportAllDeclaration(export) => {
                return Err(format!(
                    "`export * from '{}'` is not supported in a story file",
                    export.source.value.display()
                ));
            }
            Statement::ExpressionStatement(expression) => match bare(&expression.expression) {
                Expression::AssignmentExpression(assignment) => {
                    let Some(member) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    let (Expression::Identifier(object), Some(key)) =
                        (member.object(), member.static_property_name())
                    else {
                        continue;
                    };
                    let key = key.display().to_string();
                    let key = key.as_str();
                    let local = object.name.as_str();
                    let Some(story) = stories.iter_mut().find(|story| story.export_name == local)
                    else {
                        continue;
                    };
                    let value = &assignment.right;
                    if key == "story"
                        && let Expression::ObjectExpression(object) = bare(value)
                    {
                        for (key, value) in identifier_members(object) {
                            story.annotate(key, value);
                        }
                    } else {
                        story.annotate(key, Some(value));
                    }
                    if key == "storyName"
                        && let Some(name) = string_literal(value)
                    {
                        story.name = name;
                    }
                }
                Expression::CallExpression(call) => {
                    if let Expression::StaticMemberExpression(member) = bare(&call.callee)
                        && member.property.name == "test"
                        && matches!(bare(&member.object), Expression::Identifier(_))
                        && call.arguments.len() >= 2
                    {
                        return Err("story tests (`Story.test(...)`) are not supported".into());
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    let meta = meta.ok_or("CSF: missing default export")?;
    Ok((meta, stories, order))
}

/// How a play function is known: from the annotations, then the evaluated story, then meta.
fn play_presence(story: &Story, value: &Value, meta: &Value) -> Presence {
    if story.annotation("play").is_some() {
        return Presence::Present;
    }
    let level = |value: &Value| match value {
        Value::Object(object) => match object.get("play") {
            Field::Set(Value::Undefined | Value::Null) | Field::Absent => Presence::Absent,
            Field::Set(Value::Unknown(_)) | Field::Unknown(_) => Presence::Unknown,
            Field::Set(_) => Presence::Present,
        },
        Value::Function => Presence::Absent,
        _ => Presence::Unknown,
    };
    // `story.play ?? meta.play`: a play on either is a play.
    match (level(value), level(meta)) {
        (Presence::Present, _) | (_, Presence::Present) => Presence::Present,
        (Presence::Absent, Presence::Absent) => Presence::Absent,
        _ => Presence::Unknown,
    }
}

/// Fields a level sets that cannot be read: an unknown value, or an object an unreadable spread
/// may have added to (`args.*`). Computed leaf values inside readable objects are runtime data
/// and are not listed.
fn unresolved(level: &'static str, value: &Value, out: &mut Vec<Unresolved>) {
    fn open(
        level: &'static str,
        path: &str,
        object: &super::value::Object,
        out: &mut Vec<Unresolved>,
    ) {
        for (field, value) in &object.fields {
            if let Value::Object(nested) = value {
                open(level, &format!("{path}{field}."), nested, out);
            }
        }
        if let Some(reason) = &object.open {
            out.push(Unresolved {
                level,
                field: format!("{path}*"),
                reason: reason.clone(),
            });
        }
    }
    match value {
        Value::Unknown(reason) => out.push(Unresolved {
            level,
            field: "*".into(),
            reason: reason.clone(),
        }),
        Value::Object(object) => {
            for (field, value) in &object.fields {
                if let Value::Unknown(reason) = value {
                    out.push(Unresolved {
                        level,
                        field: field.clone(),
                        reason: reason.clone(),
                    });
                }
            }
            open(level, "", object, out);
        }
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn entries<'p, 'a>(
    result: &mut FileIndex,
    scope: &Scope<'p, 'a>,
    program: &'p Program<'a>,
    meta: Meta,
    stories: Vec<Story<'p, 'a>>,
    order: Option<Vec<String>>,
    import_path: &str,
    relative_path: &str,
    specifier: &Specifier,
    project_tags: &[String],
) -> Result<(), String> {
    let title = identity::title(
        meta.title.as_deref(),
        relative_path,
        &specifier.title_prefix,
    );
    let mut meta_tags = meta.tags.clone().unwrap_or_default();
    if meta.play {
        meta_tags.push("play-fn".into());
    }
    let meta_value = program
        .body
        .iter()
        .find_map(|statement| match statement {
            Statement::ExportDefaultDeclaration(export) => export
                .declaration
                .as_expression()
                .map(|expression| scope.evaluate(expression)),
            _ => None,
        })
        .unwrap_or(Value::Unknown(
            "the meta is exported through a specifier".into(),
        ));
    let mut selected: Vec<Story> = stories
        .into_iter()
        .filter(|story| {
            identity::is_export_story(
                &story.export_name,
                meta.include.as_ref(),
                meta.exclude.as_ref(),
            )
        })
        .collect();
    if let Some(order) = order {
        let before = selected.len();
        let mut sorted = Vec::new();
        for name in &order {
            if let Some(position) = selected.iter().position(|story| &story.export_name == name) {
                sorted.push(selected.remove(position));
            }
        }
        if sorted.len() != before {
            let missing: Vec<_> = selected
                .iter()
                .map(|story| story.export_name.clone())
                .collect();
            return Err(format!("Missing exports after sort: {}", missing.join(",")));
        }
        selected = sorted;
    }
    for story in selected {
        let id = match &story.explicit_id {
            Some(id) => id.clone(),
            None => identity::to_id(
                meta.id.as_deref().unwrap_or(&title),
                &identity::story_name_from_export(&story.export_name),
            )?,
        };
        let mut story_tags = match story.annotation("tags") {
            Some(value) => tags_of(value, program)?,
            None => Vec::new(),
        };
        if story.annotation("play").is_some() {
            story_tags.push("play-fn".into());
        }
        let tags = identity::combine_tags(
            project_tags
                .iter()
                .chain(&meta_tags)
                .chain(&story_tags)
                .map(String::as_str),
        );
        let value = scope.identifier(&story.local);
        let mut missing = Vec::new();
        unresolved("meta", &meta_value, &mut missing);
        unresolved("story", &value, &mut missing);
        result.entries.push(Entry {
            play: play_presence(&story, &value, &meta_value),
            id,
            title: title.clone(),
            name: story.name,
            import_path: import_path.to_string(),
            export_name: story.export_name,
            tags,
            component: meta.component.clone(),
            unresolved: missing,
            annotations: Annotations {
                meta: field_names(&meta_value),
                story: {
                    let mut names = field_names(&value);
                    for (key, _) in &story.annotations {
                        if !names.contains(key) {
                            names.push(key.clone());
                        }
                    }
                    names
                },
            },
        });
    }
    if result.entries.is_empty() {
        result
            .warnings
            .push(format!("{import_path} has no stories"));
    }
    Ok(())
}

/// Files under `directory` whose path relative to it matches `pattern`, skipping
/// `node_modules` and dot-directories as Storybook's glob does.
fn walk(directory: &Path, relative: &str, pattern: &str, found: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = format!("{relative}{name}");
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if name == "node_modules" || name.starts_with('.') {
                continue;
            }
            walk(&entry.path(), &format!("{path}/"), pattern, found);
        } else if fast_glob::glob_match(pattern, &path) {
            found.push((entry.path(), path));
        }
    }
}

/// `./`-prefixed, `/`-separated path of `path` relative to `root`; `None` outside it.
fn import_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_string())
        .collect();
    Some(format!("./{}", parts.join("/")))
}

/// The project annotations' fields, and the preview's own tags when they are readable.
type PreviewRead = (Vec<String>, Result<Vec<String>, String>);

/// The project annotations' fields, and Storybook's `getProjectTags`: the preview's own `tags`.
fn read_preview(source: &str, path: &str) -> Result<PreviewRead, String> {
    let allocator = oxc::allocator::Allocator::default();
    let source_type = oxc::span::SourceType::from_path(path)
        .map_err(|_| "not a JavaScript or TypeScript file".to_string())?;
    let parsed = oxc::parser::Parser::new(&allocator, source, source_type).parse();
    if let Some(error) = parsed.diagnostics.errors().next() {
        return Err(format!("does not parse: {error}"));
    }
    let program = &parsed.program;
    let scope = Scope::new(program);
    let annotations = program
        .body
        .iter()
        .find_map(|statement| match statement {
            Statement::ExportDefaultDeclaration(export) => export
                .declaration
                .as_expression()
                .map(|expression| field_names(&scope.evaluate(expression))),
            _ => None,
        })
        .unwrap_or_else(|| vec!["*".into()]);
    for statement in &program.body {
        match statement {
            Statement::ExportDefaultDeclaration(export) => {
                let Some(expression) = export.declaration.as_expression() else {
                    continue;
                };
                let object = match bare(expression) {
                    Expression::Identifier(identifier) => {
                        var_initialization(identifier.name.as_str(), program).and_then(meta_object)
                    }
                    _ => meta_object(expression),
                };
                if let Some(object) = object
                    && let Some((_, value)) = identifier_members(object)
                        .into_iter()
                        .find(|(key, _)| *key == "tags")
                {
                    return Ok((annotations, tags_of(value, program)));
                }
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(variables) = &export.declaration {
                    for declarator in &variables.declarations {
                        if declarator
                            .id
                            .get_identifier_name()
                            .is_some_and(|name| name == "tags")
                        {
                            return Ok((annotations, parse_tags(declarator.init.as_ref())));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok((annotations, Ok(Vec::new())))
}

pub fn index(request: &IndexRequest) -> Index {
    let root = std::fs::canonicalize(&request.root).unwrap_or_else(|_| request.root.clone());
    let mut index = Index {
        entries: Vec::new(),
        project_tags: DEFAULT_TAGS.iter().map(|tag| tag.to_string()).collect(),
        project_annotations: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
        files: Vec::new(),
    };
    let problem = |import_path: Option<&str>, code: &'static str, message: String| Problem {
        import_path: import_path.map(String::from),
        export_name: None,
        code,
        message,
    };
    if let Some(preview) = &request.preview {
        let path = request.base.join(preview);
        index.files.push(path.to_string_lossy().to_string());
        match std::fs::read_to_string(&path) {
            Ok(source) => match read_preview(&source, &path.to_string_lossy()) {
                Ok((annotations, tags)) => {
                    index.project_annotations = annotations;
                    match tags {
                        Ok(tags) => index.project_tags.extend(tags),
                        // Storybook warns and indexes without project tags.
                        Err(error) => index.warnings.push(problem(
                            None,
                            "UNREADABLE_PROJECT_TAGS",
                            format!("Unable to parse tags from {preview}: {error}"),
                        )),
                    }
                }
                Err(error) => index.errors.push(problem(
                    None,
                    "UNREADABLE_PROJECT",
                    format!("{preview} cannot be read: {error}"),
                )),
            },
            Err(error) => index.errors.push(problem(
                None,
                "UNREADABLE_FILE",
                format!("{preview} cannot be read: {error}"),
            )),
        }
    }
    let mut seen: HashMap<String, (String, String)> = HashMap::new();
    for specifier in &request.stories {
        let directory = request.base.join(&specifier.directory);
        let directory = std::fs::canonicalize(&directory).unwrap_or(directory);
        let mut found = Vec::new();
        walk(&directory, "", &specifier.files, &mut found);
        for (path, relative) in found {
            let path = std::fs::canonicalize(&path).unwrap_or(path);
            let Some(import) = import_path(&root, &path) else {
                index.errors.push(problem(
                    None,
                    "OUTSIDE_ROOT",
                    format!("{} is outside the bench root", path.display()),
                ));
                continue;
            };
            index.files.push(path.to_string_lossy().to_string());
            let source = match std::fs::read_to_string(&path) {
                Ok(source) => source,
                Err(error) => {
                    index.errors.push(problem(
                        Some(&import),
                        "UNREADABLE_FILE",
                        format!("{import} cannot be read: {error}"),
                    ));
                    continue;
                }
            };
            let file = index_file(
                &source,
                &path.to_string_lossy(),
                &import,
                &relative,
                specifier,
                &index.project_tags,
            );
            for error in file.errors {
                index.errors.push(problem(
                    Some(&import),
                    "UNINDEXABLE_FILE",
                    format!("Unable to index {import}: {error}"),
                ));
            }
            for warning in file.warnings {
                index
                    .warnings
                    .push(problem(Some(&import), "NO_STORIES", warning));
            }
            for entry in file.entries {
                if let Some((path, export)) = seen.get(&entry.id) {
                    // Storybook throws across files and keeps the first story within one file.
                    let message = format!(
                        "Duplicate stories with id: {} ({path}#{export} and {}#{}){}",
                        entry.id,
                        entry.import_path,
                        entry.export_name,
                        if *path == entry.import_path {
                            " (Storybook's index keeps only the first; its Vitest run tests both)"
                        } else {
                            ""
                        }
                    );
                    index.errors.push(Problem {
                        import_path: Some(entry.import_path.clone()),
                        export_name: Some(entry.export_name.clone()),
                        code: "DUPLICATE_ID",
                        message,
                    });
                    continue;
                }
                seen.insert(
                    entry.id.clone(),
                    (entry.import_path.clone(), entry.export_name.clone()),
                );
                index.entries.push(entry);
            }
        }
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(source: &str) -> FileIndex {
        let specifier = Specifier {
            directory: ".".into(),
            files: "**/*.stories.ts".into(),
            title_prefix: String::new(),
        };
        let tags: Vec<String> = DEFAULT_TAGS.iter().map(|tag| tag.to_string()).collect();
        index_file(
            source,
            "x.stories.ts",
            "./x.stories.ts",
            "x.stories.ts",
            &specifier,
            &tags,
        )
    }

    #[test]
    fn reads_names_ids_and_tags_as_storybook_does() {
        let file = read(
            "const meta = { title: 'Fixtures/Identity', tags: ['fixture'], excludeStories: /^helper/ } satisfies Meta;\n\
             export default meta;\n\
             const base = { name: 'Spread name', tags: ['spread'] };\n\
             export const helperData = {};\n\
             export const Primary = { args: {} };\n\
             export const Named = { name: 'Explicit', tags: ['!dev', 'extra'], play: async () => {} };\n\
             export const Spread = { ...base };\n\
             export const WithId = { parameters: { __id: 'custom--id' } };\n\
             export function Legacy() {}\n\
             Legacy.storyName = 'Legacy name';\n\
             const Local = { name: 'Ignored' };\n\
             export { Local as Renamed };\n",
        );
        assert!(file.errors.is_empty(), "{:?}", file.errors);
        let rows: Vec<_> = file
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.id.as_str(),
                    entry.name.as_str(),
                    entry.tags.join(","),
                    entry.play,
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                (
                    "fixtures-identity--primary",
                    "Primary",
                    "dev,test,manifest,fixture".into(),
                    Presence::Absent
                ),
                (
                    "fixtures-identity--named",
                    "Explicit",
                    "test,manifest,fixture,extra,play-fn".into(),
                    Presence::Present
                ),
                (
                    "fixtures-identity--spread",
                    "Spread",
                    "dev,test,manifest,fixture".into(),
                    Presence::Absent
                ),
                (
                    "custom--id",
                    "With Id",
                    "dev,test,manifest,fixture".into(),
                    Presence::Absent
                ),
                (
                    "fixtures-identity--legacy",
                    "Legacy name",
                    "dev,test,manifest,fixture".into(),
                    Presence::Absent
                ),
                (
                    "fixtures-identity--renamed",
                    "Renamed",
                    "dev,test,manifest,fixture".into(),
                    Presence::Absent
                ),
            ]
        );
    }

    #[test]
    fn reports_dynamic_values_and_unindexable_files() {
        let file = read(
            "import { make } from './make';\n\
             export default { title: 'Fixtures/Dynamic', play: async () => {} };\n\
             export const Made = make();\n",
        );
        assert_eq!(file.entries[0].play, Presence::Present);
        assert_eq!(file.entries[0].tags, ["dev", "test", "manifest", "play-fn"]);
        assert!(
            file.entries[0]
                .unresolved
                .iter()
                .any(|item| item.field == "*" && item.reason.contains("make"))
        );
        for (source, error) in [
            ("export const A = {};", "missing default export"),
            (
                "const title = `T`;\nexport default { title };",
                "dynamic title",
            ),
            (
                "export default { title: 'T', tags: 'x' };",
                "Expected tags array",
            ),
            (
                "export default { title: 'T' };\nexport const A = {};\nexport const B = {};\nexport const __namedExportsOrder = ['B'];",
                "Missing exports after sort: A",
            ),
            (
                "export default { title: 'T', excludeStories: ['a', /b/] };",
                "Expected string literal",
            ),
            ("export default make();", "default export must be an object"),
        ] {
            let file = read(source);
            assert!(
                file.errors.iter().any(|message| message.contains(error)),
                "{source}: {:?}",
                file.errors
            );
        }
    }
}
