//! Static values: what a story file's annotations are, read without running the file. A value
//! that cannot be read statically is `Unknown`, with the reason, never a guess.

use oxc::ast::ast::{
    ArrayExpressionElement, BindingPattern, Declaration, Expression, ImportDeclarationSpecifier,
    ObjectPropertyKind, Program, PropertyKind, Statement, UnaryOperator,
};
use std::collections::HashMap;

/// Reference and spread chains such as `...Story.args` through nested local constants.
const MAX_DEPTH: usize = 12;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    /// A regular expression literal's source and flags.
    RegExp(String, String),
    Array(Vec<Value>),
    Object(Object),
    /// A function: its presence is known, its behavior is not read.
    Function,
    Unknown(String),
}

/// An object's fields in source order. `open` is set when a spread could not be read: fields
/// written after it are known, and any other field might have come from it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Object {
    pub fields: Vec<(String, Value)>,
    pub open: Option<String>,
}

/// What reading one field of an object gives.
#[derive(Debug, Clone, PartialEq)]
pub enum Field<'v> {
    Set(&'v Value),
    Absent,
    /// The field may have come from a spread that could not be read.
    Unknown(&'v str),
}

impl Object {
    pub fn get(&self, name: &str) -> Field<'_> {
        match self.fields.iter().rev().find(|(key, _)| key == name) {
            Some((_, value)) => Field::Set(value),
            None => match &self.open {
                Some(reason) => Field::Unknown(reason),
                None => Field::Absent,
            },
        }
    }

    fn set(&mut self, name: String, value: Value) {
        self.fields.retain(|(key, _)| *key != name);
        self.fields.push((name, value));
    }

    /// Merge a spread: a readable object's fields override earlier ones; an unreadable one
    /// makes every earlier field unknown.
    fn spread(&mut self, value: Value) {
        match value {
            Value::Object(object) => {
                if let Some(reason) = object.open {
                    for (_, value) in &mut self.fields {
                        *value = Value::Unknown(reason.clone());
                    }
                    self.open = Some(reason);
                }
                for (key, value) in object.fields {
                    self.set(key, value);
                }
            }
            // Spreading these adds no own enumerable fields.
            Value::Undefined | Value::Null | Value::Bool(_) | Value::Number(_) => {}
            Value::Unknown(reason) => {
                for (_, value) in &mut self.fields {
                    *value = Value::Unknown(reason.clone());
                }
                self.open = Some(reason);
            }
            other => {
                let reason = format!("spread of a {} is not read", other.kind());
                for (_, value) in &mut self.fields {
                    *value = Value::Unknown(reason.clone());
                }
                self.open = Some(reason);
            }
        }
    }
}

impl Value {
    pub fn kind(&self) -> &'static str {
        match self {
            Value::Undefined => "undefined",
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::RegExp(..) => "regular expression",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
            Value::Function => "function",
            Value::Unknown(_) => "unknown value",
        }
    }
}

/// Top-level bindings of one module: what each name was declared with.
pub struct Scope<'p, 'a> {
    bindings: HashMap<&'a str, Binding<'p, 'a>>,
}

enum Binding<'p, 'a> {
    Expression(&'p Expression<'a>),
    /// Declared without a statically readable initializer, such as `let x;` or a destructuring.
    Opaque(&'static str),
    Function,
    Import(String),
}

impl<'p, 'a> Scope<'p, 'a> {
    pub fn new(program: &'p Program<'a>) -> Self {
        let mut bindings = HashMap::new();
        for statement in &program.body {
            let declaration = match statement {
                Statement::ExportDeclaration(export) => Some(&export.declaration),
                Statement::ImportDeclaration(import) => {
                    for specifier in import.specifiers.iter().flatten() {
                        let local = match specifier {
                            ImportDeclarationSpecifier::ImportSpecifier(item) => &item.local,
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(item) => &item.local,
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(item) => {
                                &item.local
                            }
                        };
                        bindings.insert(
                            local.name.as_str(),
                            Binding::Import(import.source.value.display().to_string()),
                        );
                    }
                    None
                }
                _ => statement.as_declaration(),
            };
            match declaration {
                Some(Declaration::VariableDeclaration(variables)) => {
                    for declarator in &variables.declarations {
                        if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
                            let binding = match &declarator.init {
                                Some(init) => Binding::Expression(init),
                                None => Binding::Opaque("declared without a value"),
                            };
                            bindings.insert(identifier.name.as_str(), binding);
                        } else {
                            for identifier in declarator.id.get_binding_identifiers() {
                                bindings.insert(
                                    identifier.name.as_str(),
                                    Binding::Opaque("declared by destructuring"),
                                );
                            }
                        }
                    }
                }
                Some(Declaration::FunctionDeclaration(function)) => {
                    if let Some(identifier) = &function.id {
                        bindings.insert(identifier.name.as_str(), Binding::Function);
                    }
                }
                Some(Declaration::ClassDeclaration(class)) => {
                    if let Some(identifier) = &class.id {
                        bindings.insert(identifier.name.as_str(), Binding::Opaque("a class"));
                    }
                }
                _ => {}
            }
        }
        Scope { bindings }
    }

    pub fn identifier(&self, name: &str) -> Value {
        self.lookup(name, 0)
    }

    fn lookup(&self, name: &str, depth: usize) -> Value {
        match self.bindings.get(name) {
            Some(Binding::Expression(expression)) => self.evaluate_at(expression, depth + 1),
            Some(Binding::Function) => Value::Function,
            Some(Binding::Opaque(reason)) => Value::Unknown(format!("`{name}` is {reason}")),
            Some(Binding::Import(source)) => {
                Value::Unknown(format!("`{name}` is imported from '{source}'"))
            }
            None if name == "undefined" => Value::Undefined,
            None => Value::Unknown(format!("`{name}` is not declared in this module")),
        }
    }

    pub fn evaluate(&self, expression: &Expression<'a>) -> Value {
        self.evaluate_at(expression, 0)
    }

    fn evaluate_at(&self, expression: &Expression<'a>, depth: usize) -> Value {
        if depth > MAX_DEPTH {
            return Value::Unknown("references nest too deeply to read".into());
        }
        match expression.get_inner_expression() {
            Expression::NullLiteral(_) => Value::Null,
            Expression::BooleanLiteral(literal) => Value::Bool(literal.value),
            Expression::NumericLiteral(literal) => Value::Number(literal.value),
            Expression::StringLiteral(literal) => {
                Value::String(literal.value.display().to_string())
            }
            Expression::TemplateLiteral(template) => match template.single_quasi() {
                Some(text) => Value::String(text.display().to_string()),
                None => Value::Unknown("a template literal with expressions".into()),
            },
            Expression::RegExpLiteral(literal) => Value::RegExp(
                literal.regex.pattern.text.to_string(),
                literal.regex.flags.to_string(),
            ),
            Expression::UnaryExpression(unary) => {
                match (unary.operator, self.evaluate_at(&unary.argument, depth + 1)) {
                    (UnaryOperator::UnaryNegation, Value::Number(value)) => Value::Number(-value),
                    (UnaryOperator::UnaryPlus, Value::Number(value)) => Value::Number(value),
                    (UnaryOperator::LogicalNot, Value::Bool(value)) => Value::Bool(!value),
                    (UnaryOperator::Void, _) => Value::Undefined,
                    _ => Value::Unknown("an operator expression".into()),
                }
            }
            Expression::Identifier(identifier) => self.lookup(identifier.name.as_str(), depth),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                Value::Function
            }
            Expression::ArrayExpression(array) => {
                let mut items = Vec::new();
                for element in &array.elements {
                    match element {
                        ArrayExpressionElement::SpreadElement(spread) => {
                            match self.evaluate_at(&spread.argument, depth + 1) {
                                Value::Array(values) => items.extend(values),
                                Value::Unknown(reason) => return Value::Unknown(reason),
                                other => {
                                    return Value::Unknown(format!(
                                        "spread of a {} in an array",
                                        other.kind()
                                    ));
                                }
                            }
                        }
                        ArrayExpressionElement::Elision(_) => items.push(Value::Undefined),
                        element => match element.as_expression() {
                            Some(expression) => items.push(self.evaluate_at(expression, depth + 1)),
                            None => items.push(Value::Unknown("an array element".into())),
                        },
                    }
                }
                Value::Array(items)
            }
            Expression::ObjectExpression(object) => {
                let mut result = Object::default();
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            result.spread(self.evaluate_at(&spread.argument, depth + 1));
                        }
                        ObjectPropertyKind::ObjectProperty(property) => {
                            let name = if property.computed {
                                match property
                                    .key
                                    .as_expression()
                                    .map(|key| self.evaluate_at(key, depth + 1))
                                {
                                    Some(Value::String(name)) => Some(name),
                                    _ => None,
                                }
                            } else {
                                property
                                    .key
                                    .static_name()
                                    .map(|name| name.display().to_string())
                            };
                            let Some(name) = name else {
                                // A computed key that cannot be read could be any field.
                                result.spread(Value::Unknown("a computed property name".into()));
                                continue;
                            };
                            let value = if property.method {
                                Value::Function
                            } else if property.kind != PropertyKind::Init {
                                Value::Unknown("an accessor property".into())
                            } else {
                                self.evaluate_at(&property.value, depth + 1)
                            };
                            result.set(name, value);
                        }
                    }
                }
                Value::Object(result)
            }
            Expression::StaticMemberExpression(member) => {
                match self.evaluate_at(&member.object, depth + 1) {
                    Value::Object(object) => match object.get(member.property.name.as_str()) {
                        Field::Set(value) => value.clone(),
                        Field::Absent => Value::Undefined,
                        Field::Unknown(reason) => Value::Unknown(reason.to_string()),
                    },
                    Value::Unknown(reason) => Value::Unknown(reason),
                    other => Value::Unknown(format!("a property of a {}", other.kind())),
                }
            }
            Expression::CallExpression(call) => {
                let callee = match call.callee.get_inner_expression() {
                    Expression::Identifier(identifier) => format!("`{}(...)`", identifier.name),
                    Expression::StaticMemberExpression(member) => {
                        format!("a `.{}(...)` call", member.property.name)
                    }
                    _ => "a call".into(),
                };
                Value::Unknown(format!("the result of {callee}"))
            }
            Expression::NewExpression(_) => Value::Unknown("a `new` expression".into()),
            Expression::ConditionalExpression(_) | Expression::LogicalExpression(_) => {
                Value::Unknown("a conditional expression".into())
            }
            _ => Value::Unknown("an expression that is not read statically".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Field, Scope, Value};

    fn with_scope(source: &str, check: impl FnOnce(&Scope)) {
        let allocator = oxc::allocator::Allocator::default();
        let parsed =
            oxc::parser::Parser::new(&allocator, source, oxc::span::SourceType::ts()).parse();
        assert!(!parsed.diagnostics.has_errors());
        let scope = Scope::new(&parsed.program);
        check(&scope);
    }

    #[test]
    fn reads_literals_references_and_spreads() {
        with_scope(
            "import { shared } from './x';\n\
             const base = { args: { a: 1, b: 'two' }, tags: ['x'] } as const;\n\
             const Story = { ...base, args: { ...base.args, b: `three` }, play: async () => {} } satisfies object;\n\
             const Opaque = { a: 1, ...shared, b: 2 };\n\
             function render() {}\n",
            |scope| {
                let story = scope.identifier("Story");
                let Value::Object(story) = &story else {
                    panic!()
                };
                let Field::Set(Value::Object(args)) = story.get("args") else {
                    panic!()
                };
                assert_eq!(args.get("a"), Field::Set(&Value::Number(1.0)));
                assert_eq!(args.get("b"), Field::Set(&Value::String("three".into())));
                assert_eq!(story.get("play"), Field::Set(&Value::Function));
                assert_eq!(story.get("name"), Field::Absent);
                let opaque = scope.identifier("Opaque");
                let Value::Object(opaque) = &opaque else {
                    panic!()
                };
                assert!(matches!(opaque.get("a"), Field::Set(Value::Unknown(_))));
                assert_eq!(opaque.get("b"), Field::Set(&Value::Number(2.0)));
                assert!(
                    matches!(opaque.get("c"), Field::Unknown(reason) if reason.contains("'./x'"))
                );
                assert_eq!(scope.identifier("render"), Value::Function);
            },
        );
    }

    #[test]
    fn marks_calls_and_cycles_unknown() {
        with_scope(
            "const a = make({ name: 'x' });\nconst b = c;\nconst c = b;\n",
            |scope| {
                assert!(
                    matches!(scope.identifier("a"), Value::Unknown(reason) if reason.contains("make"))
                );
                assert!(matches!(scope.identifier("b"), Value::Unknown(_)));
            },
        );
    }
}
