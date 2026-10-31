import ts from 'typescript';

// Static, read-only reading of retained CSF annotations. Storybook's own index remains the
// authority for discovered identities and tags; this records what the index omits and marks
// every value it cannot read statically as unresolved instead of guessing.

const FIELDS = [
	'title',
	'id',
	'name',
	'storyName',
	'component',
	'subcomponents',
	'tags',
	'args',
	'argTypes',
	'parameters',
	'globals',
	'render',
	'play',
	'decorators',
	'loaders',
	'beforeEach',
	'afterEach',
	'mount',
	'includeStories',
	'excludeStories',
];
// Fields whose presence matters but whose values are commonly functions or arrays of functions.
const BEHAVIOR = new Set([
	'render',
	'play',
	'decorators',
	'loaders',
	'beforeEach',
	'afterEach',
	'mount',
]);
// Parameter keys that change what a test run checks or the context a case renders in.
const POLICY_PARAMETERS = ['a11y', 'test', 'viewport', 'layout', 'backgrounds', 'chromatic'];
// Matchers contributed by jest-dom rather than Vitest's expect.
const JEST_DOM = new Set([
	'toBeInTheDocument',
	'toBeVisible',
	'toBeEmptyDOMElement',
	'toBeDisabled',
	'toBeEnabled',
	'toBeInvalid',
	'toBeValid',
	'toBeRequired',
	'toBeChecked',
	'toBePartiallyChecked',
	'toHaveAttribute',
	'toHaveClass',
	'toHaveFocus',
	'toHaveFormValues',
	'toHaveStyle',
	'toHaveTextContent',
	'toHaveValue',
	'toHaveDisplayValue',
	'toHaveAccessibleName',
	'toHaveAccessibleDescription',
	'toHaveAccessibleErrorMessage',
	'toHaveRole',
	'toContainElement',
	'toContainHTML',
	'toHaveErrorMessage',
	'toHaveSelection',
]);
const MAX_TEXT = 120;
// Bounds reference and spread chains such as `...Story.args` through nested local constants.
const MAX_DEPTH = 12;

function unwrap(node) {
	while (
		node &&
		(ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isNonNullExpression(node))
	)
		node = node.expression;
	return node;
}

function keyName(name) {
	if (!name) return undefined;
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
		return name.text;
	if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
	return undefined;
}

function snippet(source, node) {
	const text = node.getText(source).replace(/\s+/g, ' ');
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** Collect file-level `const` initializers so identifiers and spreads can resolve locally. */
function localConstants(source) {
	const constants = new Map();
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
		for (const declaration of statement.declarationList.declarations)
			if (ts.isIdentifier(declaration.name) && declaration.initializer)
				constants.set(declaration.name.text, declaration.initializer);
	}
	return constants;
}

/** Resolve a same-file `const` identifier or `Local.field` access to the node it names. */
function resolveReference(node, context, depth = 0) {
	node = unwrap(node);
	if (depth >= MAX_DEPTH || !node) return node;
	if (ts.isIdentifier(node) && context.constants.has(node.text))
		return resolveReference(context.constants.get(node.text), context, depth + 1);
	if (ts.isPropertyAccessExpression(node)) {
		const target = annotationProperties(node.expression, context, depth + 1);
		const property =
			target?.unresolved.length === 0 ? target.properties.get(node.name.text) : undefined;
		if (property && !ts.isMethodDeclaration(property))
			return resolveReference(property, context, depth + 1);
		if (property) return property;
	}
	return node;
}

/**
 * Read a value statically. Returns { static: value } for JSON-representable literals,
 * { kind: 'function' } for inline functions, or { kind: 'dynamic', text } otherwise.
 */
export function readValue(node, context, depth = 0) {
	node = unwrap(node);
	if (!node) return { kind: 'dynamic', text: '<missing>' };
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return { static: node.text };
	if (ts.isNumericLiteral(node)) return { static: Number(node.text) };
	if (node.kind === ts.SyntaxKind.TrueKeyword) return { static: true };
	if (node.kind === ts.SyntaxKind.FalseKeyword) return { static: false };
	if (node.kind === ts.SyntaxKind.NullKeyword) return { static: null };
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	)
		return { static: -Number(node.operand.text) };
	if (
		ts.isArrowFunction(node) ||
		ts.isFunctionExpression(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isMethodDeclaration(node)
	)
		return { kind: 'function' };
	if (ts.isRegularExpressionLiteral(node)) return { kind: 'dynamic', text: node.text };
	if (ts.isIdentifier(node) && node.text === 'undefined') return { static: undefined };
	if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && depth < MAX_DEPTH) {
		const target = resolveReference(node, context);
		if (target !== node) {
			const resolved = ts.isMethodDeclaration(target)
				? { kind: 'function' }
				: readValue(target, context, depth + 1);
			return 'static' in resolved ? resolved : { ...resolved, via: node.getText(context.source) };
		}
	}
	if (ts.isArrayLiteralExpression(node)) {
		const values = [];
		for (const element of node.elements) {
			const value = readValue(element, context, depth + 1);
			if (!('static' in value)) return { kind: 'dynamic', text: snippet(context.source, node) };
			values.push(value.static);
		}
		return { static: values };
	}
	if (ts.isObjectLiteralExpression(node)) {
		const object = {};
		for (const property of node.properties) {
			const key = ts.isPropertyAssignment(property) ? keyName(property.name) : undefined;
			if (key === undefined) return { kind: 'dynamic', text: snippet(context.source, node) };
			const value = readValue(property.initializer, context, depth + 1);
			if (!('static' in value)) return { kind: 'dynamic', text: snippet(context.source, node) };
			object[key] = value.static;
		}
		return { static: object };
	}
	return { kind: 'dynamic', text: snippet(context.source, node) };
}

/** Expand an annotation object into its properties, following same-file spreads. */
function annotationProperties(node, context, depth = 0) {
	node = unwrap(node);
	if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && depth < MAX_DEPTH) {
		const target = resolveReference(node, context, depth);
		if (target !== node) return annotationProperties(target, context, depth + 1);
	}
	if (!ts.isObjectLiteralExpression(node)) return undefined;
	const properties = new Map();
	const unresolved = [];
	for (const property of node.properties) {
		if (ts.isSpreadAssignment(property)) {
			const spread = annotationProperties(property.expression, context, depth + 1);
			if (!spread) {
				unresolved.push({ field: '...', text: snippet(context.source, property) });
				continue;
			}
			for (const [key, value] of spread.properties) properties.set(key, value);
			unresolved.push(...spread.unresolved);
			continue;
		}
		const key = keyName(property.name);
		if (key === undefined) {
			unresolved.push({ field: '[computed]', text: snippet(context.source, property) });
			continue;
		}
		if (ts.isPropertyAssignment(property)) properties.set(key, property.initializer);
		else if (ts.isMethodDeclaration(property)) properties.set(key, property);
		else if (ts.isShorthandPropertyAssignment(property)) properties.set(key, property.name);
		// Accessors compute their value, so the field is unknown rather than absent.
		else unresolved.push({ field: key, text: snippet(context.source, property), opaque: true });
	}
	return { properties, unresolved };
}

function describeBehavior(node, context) {
	const target = resolveReference(node, context);
	if (target !== unwrap(node) && !ts.isIdentifier(target)) {
		const described = describeBehavior(target, context);
		return described.kind === 'function'
			? { ...described, via: unwrap(node).getText(context.source) }
			: described;
	}
	if (ts.isMethodDeclaration(node)) return { kind: 'function' };
	const value = readValue(node, context);
	if ('static' in value) {
		if (Array.isArray(value.static)) return { kind: 'array', count: value.static.length };
		// `play: undefined` or `null` explicitly removes an inherited behavior.
		return { kind: value.static == null ? 'absent' : 'static' };
	}
	const unwrapped = unwrap(node);
	if (ts.isArrayLiteralExpression(unwrapped))
		return { kind: 'array', count: unwrapped.elements.length };
	if (value.kind === 'function') return { kind: 'function' };
	if (ts.isIdentifier(unwrapped)) return { kind: 'reference', text: unwrapped.text };
	return value;
}

/** Context names a play reads: destructured parameters or `ctx.name` accesses. */
function playContextKeys(node, context) {
	node = resolveReference(node, context);
	if (ts.isIdentifier(node) && context.functions.has(node.text))
		node = context.functions.get(node.text);
	if (
		!(
			ts.isArrowFunction(node) ||
			ts.isFunctionExpression(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isFunctionDeclaration(node)
		)
	)
		return undefined;
	const [parameter] = node.parameters;
	if (!parameter) return [];
	if (ts.isObjectBindingPattern(parameter.name))
		return parameter.name.elements
			.map((element) =>
				element.dotDotDotToken ? '<rest>' : keyName(element.propertyName ?? element.name)
			)
			.filter(Boolean)
			.sort();
	if (!ts.isIdentifier(parameter.name)) return ['<pattern>'];
	const name = parameter.name.text;
	const keys = new Set();
	const visit = (child) => {
		if (
			ts.isPropertyAccessExpression(child) &&
			ts.isIdentifier(child.expression) &&
			child.expression.text === name
		)
			keys.add(child.name.text);
		ts.forEachChild(child, visit);
	};
	if (node.body) visit(node.body);
	return [...keys].sort();
}

// A spread or computed key that cannot be read may set any field: callers must not fall back
// to an outer level for fields this level does not show.
const OPAQUE = new Set(['...', '[computed]']);
const isOpaque = (item) => item.opaque === true || OPAQUE.has(item.field);

function describeAnnotations(properties, unresolved, context) {
	const annotations = {
		resolved: false,
		opaque: unresolved.some(isOpaque),
		fields: {},
		unresolved,
	};
	for (const [key, value] of properties) {
		if (!FIELDS.includes(key)) {
			annotations.fields[key] = { kind: 'unknown-field' };
			continue;
		}
		if (BEHAVIOR.has(key)) {
			const described = describeBehavior(value, context);
			if (key === 'play') {
				const keys = playContextKeys(value, context);
				if (keys) described.contextKeys = keys;
			}
			annotations.fields[key] = described;
		} else if (key === 'args' || key === 'argTypes') {
			const expanded = annotationProperties(value, context);
			annotations.fields[key] = expanded
				? {
						kind: 'object',
						keys: [...expanded.properties.keys()].sort(),
						unresolved: expanded.unresolved.length,
					}
				: readValue(value, context);
		} else if (key === 'parameters') {
			const expanded = annotationProperties(value, context);
			if (!expanded) {
				annotations.fields[key] = readValue(value, context);
			} else {
				const policies = {};
				for (const name of POLICY_PARAMETERS) {
					if (!expanded.properties.has(name)) continue;
					policies[name] = readValue(expanded.properties.get(name), context);
					if (!('static' in policies[name]))
						unresolved.push({
							field: `parameters.${name}`,
							text: policies[name].text ?? '<dynamic>',
						});
				}
				annotations.fields[key] = {
					kind: 'object',
					keys: [...expanded.properties.keys()].sort(),
					policies,
					opaque: expanded.unresolved.some(isOpaque),
					unresolved: expanded.unresolved.length,
				};
			}
		} else {
			annotations.fields[key] = readValue(value, context);
		}
		const field = annotations.fields[key];
		if (field.kind === 'dynamic' || field.unresolved > 0)
			unresolved.push({ field: key, text: field.text ?? '<partial object>' });
	}
	// A nested write such as `Story.parameters.a11y = ...` leaves its root field unreadable.
	for (const item of unresolved)
		if (item.root) annotations.fields[item.root] = { kind: 'dynamic', text: item.text };
	annotations.resolved = unresolved.length === 0;
	return annotations;
}

function applyAssignments(properties, unresolved, assignments) {
	for (const assignment of assignments) {
		if (assignment.field) properties.set(assignment.field, assignment.value);
		else unresolved.push({ field: assignment.path, root: assignment.root, text: assignment.text });
	}
}

/** Read an annotation object, then apply later top-level `Local.field = value` assignments. */
function readAnnotations(node, context, assignments = []) {
	const expanded = annotationProperties(node, context);
	if (!expanded) return { resolved: false, text: snippet(context.source, unwrap(node)) };
	const properties = new Map(expanded.properties);
	const unresolved = [...expanded.unresolved];
	applyAssignments(properties, unresolved, assignments);
	return describeAnnotations(properties, unresolved, context);
}

/** Top-level `Story.field = value` statements, grouped by the assigned local name. */
function collectAssignments(source) {
	const assignments = new Map();
	for (const statement of source.statements) {
		if (!ts.isExpressionStatement(statement)) continue;
		const expression = statement.expression;
		if (
			!ts.isBinaryExpression(expression) ||
			expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
		)
			continue;
		const path = [];
		let target = expression.left;
		while (ts.isPropertyAccessExpression(target)) {
			path.unshift(target.name.text);
			target = target.expression;
		}
		if (!ts.isIdentifier(target) || !path.length) continue;
		const list = assignments.get(target.text) ?? [];
		// Nested writes such as `Story.args.size = ...` change a field this reader cannot merge.
		list.push(
			path.length === 1
				? { field: path[0], value: expression.right }
				: { path: path.join('.'), root: path[0], text: snippet(source, statement) }
		);
		assignments.set(target.text, list);
	}
	return assignments;
}

function collectImports(source) {
	const imports = {};
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		const specifier = statement.moduleSpecifier.text;
		if (!/^(storybook|@storybook\/|@testing-library\/|@vitest\/|vitest)/.test(specifier)) continue;
		const clause = statement.importClause;
		const names = [];
		if (clause?.isTypeOnly) continue;
		if (clause?.name) names.push('default');
		const bindings = clause?.namedBindings;
		if (bindings && ts.isNamedImports(bindings))
			for (const element of bindings.elements)
				if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
		if (bindings && ts.isNamespaceImport(bindings)) names.push('*');
		if (names.length)
			imports[specifier] = [...new Set([...(imports[specifier] ?? []), ...names])].sort();
	}
	return imports;
}

function collectMatchers(source) {
	const used = new Set();
	const visit = (node) => {
		if (ts.isPropertyAccessExpression(node) && JEST_DOM.has(node.name.text))
			used.add(node.name.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return [...used].sort();
}

/** Analyze one story module. Returns meta and per-export annotations plus anything unreadable. */
export function analyzeStoryModule(text, fileName = 'story.ts') {
	const kind = /\.[cm]?jsx$|\.tsx$/.test(fileName)
		? ts.ScriptKind.TSX
		: /\.[cm]?js$/.test(fileName)
			? ts.ScriptKind.JS
			: ts.ScriptKind.TS;
	const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
	const functions = new Map();
	for (const statement of source.statements)
		if (ts.isFunctionDeclaration(statement) && statement.name)
			functions.set(statement.name.text, statement);
	const context = { source, constants: localConstants(source), functions };
	const assignments = collectAssignments(source);
	const exports = new Map();
	const locals = new Map();
	const problems = source.parseDiagnostics.map((diagnostic) => ({
		kind: 'parse-error',
		text: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
	}));
	let metaNode;
	let metaLocal;
	for (const statement of source.statements) {
		if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
			metaNode = statement.expression;
			const local = unwrap(metaNode);
			if (ts.isIdentifier(local)) metaLocal = local.text;
			continue;
		}
		const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
		const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
		const isDefault = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
		if (exported && ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name)) {
					problems.push({ kind: 'unreadable-export', text: snippet(source, declaration) });
					continue;
				}
				exports.set(declaration.name.text, declaration.initializer);
				locals.set(declaration.name.text, declaration.name.text);
			}
		} else if (exported && ts.isFunctionDeclaration(statement) && statement.name && !isDefault) {
			exports.set(statement.name.text, statement);
			locals.set(statement.name.text, statement.name.text);
		} else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
			if (
				statement.moduleSpecifier ||
				!statement.exportClause ||
				!ts.isNamedExports(statement.exportClause)
			) {
				problems.push({ kind: 'reexport', text: snippet(source, statement) });
				continue;
			}
			for (const element of statement.exportClause.elements) {
				if (element.isTypeOnly) continue;
				const local = (element.propertyName ?? element.name).text;
				const name = element.name.text;
				if (name === 'default') {
					metaNode = context.constants.get(local);
					metaLocal = local;
				} else exports.set(name, context.constants.get(local) ?? context.functions.get(local));
				locals.set(name, local);
			}
		}
	}
	const meta = metaNode
		? readAnnotations(metaNode, context, assignments.get(metaLocal) ?? [])
		: undefined;
	const stories = {};
	for (const [name, initializer] of exports) {
		const assigned = assignments.get(locals.get(name)) ?? [];
		if (name === '__namedExportsOrder') continue;
		if (!initializer) {
			stories[name] = { resolved: false, text: '<no local initializer>' };
			continue;
		}
		const unwrapped = unwrap(initializer);
		// CSF2 function stories render through the function; other annotations are assigned later.
		if (
			ts.isFunctionDeclaration(unwrapped) ||
			ts.isArrowFunction(unwrapped) ||
			ts.isFunctionExpression(unwrapped)
		) {
			const properties = new Map([['render', unwrapped]]);
			const unresolved = [];
			applyAssignments(properties, unresolved, assigned);
			stories[name] = { csf2: true, ...describeAnnotations(properties, unresolved, context) };
			continue;
		}
		stories[name] = readAnnotations(initializer, context, assigned);
	}
	if (!meta) problems.push({ kind: 'missing-default-export' });
	return {
		meta,
		stories,
		imports: collectImports(source),
		jestDomMatchers: collectMatchers(source),
		problems,
	};
}
