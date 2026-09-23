/**
 * @fileoverview A small JSON Schema → TypeScript type generator for afd-schema.
 *
 * Covers what `z.toJSONSchema()` emits for command inputs: primitive types,
 * `integer`, `null`, arrays, objects (with `required` and `additionalProperties`),
 * `enum`, `const`, `anyOf`/`oneOf` (unions) and `allOf` (intersections).
 * Anything else, including `$ref`, becomes `unknown`.
 */

const MAX_DEPTH = 32;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaList(value: unknown): Schema[] | undefined {
	return Array.isArray(value) && value.length > 0 ? value.filter(isSchema) : undefined;
}

function literal(value: unknown): string {
	return value === undefined ? 'undefined' : JSON.stringify(value);
}

function comment(description: unknown, indent: string): string {
	if (typeof description !== 'string' || description.length === 0) return '';
	return `${indent}/** ${description.replace(/\*\//g, '*\\/').replace(/\s*\n\s*/g, ' ')} */\n`;
}

/** Whether a type expression has a `|` or `&` outside brackets and string literals. */
function hasTopLevelOperator(type: string): boolean {
	let depth = 0;
	let inString = false;
	for (let i = 0; i < type.length; i++) {
		const char = type[i];
		if (inString) {
			if (char === '\\') i++;
			else if (char === '"') inString = false;
		} else if (char === '"') inString = true;
		else if (char === '{' || char === '(' || char === '<' || char === '[') depth++;
		else if (char === '}' || char === ')' || char === '>' || char === ']') depth--;
		else if (depth === 0 && (char === '|' || char === '&')) return true;
	}
	return false;
}

function union(members: string[], separator: ' | ' | ' & '): string {
	const unique = [...new Set(members)];
	if (unique.length === 1) return unique[0] ?? 'unknown';
	return unique
		.map((member) => (hasTopLevelOperator(member) ? `(${member})` : member))
		.join(separator);
}

function objectType(schema: Schema, indent: string, depth: number): string {
	const properties = isSchema(schema.properties) ? schema.properties : {};
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	const inner = `${indent}\t`;
	const lines: string[] = [];
	for (const [key, value] of Object.entries(properties)) {
		const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
		const optional = required.has(key) ? '' : '?';
		const description = isSchema(value) ? value.description : undefined;
		lines.push(
			`${comment(description, inner)}${inner}${name}${optional}: ${toType(value, inner, depth + 1)};`
		);
	}
	const extra = schema.additionalProperties;
	if (isSchema(extra)) {
		lines.push(`${inner}[key: string]: ${toType(extra, inner, depth + 1)};`);
	} else if (extra === true) {
		lines.push(`${inner}[key: string]: unknown;`);
	}
	return lines.length === 0 ? 'Record<string, never>' : `{\n${lines.join('\n')}\n${indent}}`;
}

function typeKeyword(type: unknown, schema: Schema, indent: string, depth: number): string {
	switch (type) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'null':
			return 'null';
		case 'array':
			return isSchema(schema.items)
				? `Array<${toType(schema.items, indent, depth + 1)}>`
				: 'unknown[]';
		case 'object':
			return objectType(schema, indent, depth);
		default:
			return 'unknown';
	}
}

/**
 * Convert a JSON Schema to a TypeScript type expression.
 *
 * @param schema - JSON Schema (draft-7)
 * @param indent - Indentation of the line the type starts on
 */
export function toType(schema: unknown, indent = '', depth = 0): string {
	if (!isSchema(schema) || depth > MAX_DEPTH) return 'unknown';
	if ('const' in schema) return literal(schema.const);
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		return union(schema.enum.map(literal), ' | ');
	}
	const alternatives = schemaList(schema.anyOf) ?? schemaList(schema.oneOf);
	if (alternatives) {
		return union(
			alternatives.map((member) => toType(member, indent, depth + 1)),
			' | '
		);
	}
	const parts = schemaList(schema.allOf);
	if (parts) {
		return union(
			parts.map((member) => toType(member, indent, depth + 1)),
			' & '
		);
	}
	if (Array.isArray(schema.type)) {
		return union(
			schema.type.map((type) => typeKeyword(type, schema, indent, depth)),
			' | '
		);
	}
	if (schema.type === undefined && isSchema(schema.properties)) {
		return objectType(schema, indent, depth);
	}
	return typeKeyword(schema.type, schema, indent, depth);
}

/** `todo-create` → `TodoCreateInput`. */
export function inputTypeName(commandName: string): string {
	const pascal = commandName
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
	const base = pascal.length > 0 ? pascal : 'Command';
	return `${/^[0-9]/.test(base) ? '_' : ''}${base}Input`;
}

/**
 * Generate one TypeScript module declaring an input type per command
 * (`todo-create` → `export type TodoCreateInput = …`).
 */
export function generateInputTypes(
	commands: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }>
): string {
	const used = new Set<string>();
	const declarations = commands.map((command) => {
		const base = inputTypeName(command.name);
		let name = base;
		for (let suffix = 2; used.has(name); suffix++) name = `${base}${suffix}`;
		used.add(name);
		const doc = comment(`Input of \`${command.name}\`: ${command.description}`, '');
		return `${doc}export type ${name} = ${toType(command.inputSchema)};`;
	});
	return `${declarations.join('\n\n')}\n`;
}
