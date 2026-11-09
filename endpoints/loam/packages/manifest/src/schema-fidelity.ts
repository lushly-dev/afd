/**
 * @fileoverview Where Zod's `fromJSONSchema`, the kernel's validator of an app's input, config and document
 * content, would not honour a schema it accepts, read from Zod's converter and held to Ajv by
 * `schema-fidelity.test.ts` (phase 1 specification, `input-schema`; documents specification, Follow-ups):
 *
 * - it reads a type's keywords only under that `type`, so a branch with `required` and no `type` checks nothing,
 *   and an array's `minItems` and `maxItems` only beside `items` or `prefixItems`;
 * - it reads `$ref`, `enum` and `const` alone, ignoring a type's keywords beside them, and compares an object
 *   or array value by identity, so it never matches;
 * - it requires only a property `properties` declares, and fills in a `default`, so a default at the root, in
 *   a branch, in `$defs` or in `prefixItems` can stand in for a required value;
 * - it lets a value go missing where its schema both accepts `undefined` and is marked optional, as a union is
 *   when a branch accepts anything beside one it checks apart, and it pads a tuple with such items;
 * - an intersection, which `allOf` or a branch beside `type` makes, refuses a key only when both sides do, so
 *   `additionalProperties: false` and `propertyNames` there let keys through, and two defaults there throw;
 * - with no `type`, a second of `allOf`, `anyOf` and `oneOf` replaces the first;
 * - it compiles `pattern` and `patternProperties` without the `u` flag, so `\p{L}` is a `p`;
 * - it resolves `$ref` as `#` or `#/$defs/<name>` only, from the root's `$defs` or else `definitions`, and
 *   recurses without end on references that reach themselves through branches alone, and the join that
 *   weakens a closed object reaches through `$ref` and nested branches too;
 * - it reads a property named after a member of `Object.prototype` from the prototype when the key is missing;
 * - it checks `format` by definitions of its own, ignores `nullable`, `$dynamicRef`, a nested `$id` and
 *   `additionalProperties` beside `patternProperties` unless it is `false`, and reads draft 2020-12 only.
 */

type Node = Record<string, unknown>;

/** A refusal: what Zod does with the keyword, and how to restructure the schema. */
export type Refusal = [problem: string, remedy: string];

/**
 * The keywords Zod reads only under the `type` it converts, an object's first; `$ref`, `enum` and `const`
 * read alone.
 */
const TYPED =
	'properties required additionalProperties patternProperties propertyNames minProperties maxProperties items prefixItems contains minItems maxItems uniqueItems minContains maxContains minLength maxLength pattern minimum maximum exclusiveMinimum exclusiveMaximum multipleOf'.split(
		' '
	);
const BRANCHES = ['allOf', 'anyOf', 'oneOf'];

/** Each refusal's reason and remedy, by keyword or kind; `{}` is the name it gives. */
const WHY: Record<string, Refusal> = {
	object: [
		'which Zod ignores with no `type` beside it',
		'Give this branch `type: object` beside `{}`, or require top-level properties told apart by an `enum`.',
	],
	untyped: [
		'which Zod ignores with no `type` beside it',
		'Give this subschema the `type` that `{}` constrains.',
	],
	branches: [
		'which replaces the `{}` beside it, as Zod keeps one branch keyword where there is no `type`',
		'Add the `type` beside them, or put each in its own `allOf` branch.',
	],
	ref: ['which Zod ignores beside `$ref`', 'Move it into the `$defs` entry the `$ref` names.'],
	value: ['which Zod ignores beside `{}`', 'Remove it, and list only the values it allows.'],
	values: [
		'which holds an object, an array or a value `type` refuses: Zod never matches the first two and accepts the last',
		'List only strings, numbers, booleans or null that `type` allows, and describe an object with `properties`.',
	],
	undeclared: [
		'which names `{}`, a property `properties` does not declare, so Zod does not require it',
		'Declare `{}` in `properties`, or remove it from `required`.',
	],
	defaulted: [
		'which names `{}`, a property whose `default` Zod fills in, so Zod does not require it',
		'Remove the `default` of `{}`, or remove `{}` from `required`.',
	],
	items: [
		'which Zod ignores on an array with no `items` or `prefixItems`',
		'Add `items: true`, or the schema of the items.',
	],
	missing: [
		'which names `{}`, whose schema Zod lets go missing: a branch that accepts anything sits beside one with `uniqueItems`, `contains`, `minProperties`, `maxProperties` or `propertyNames`',
		'Remove the branch that accepts anything, or give it a `type`.',
	],
	padded: [
		'which gives one of the first `minItems` items a schema that accepts anything, so Zod pads a short array to meet `minItems`',
		'Give each of the first `minItems` items a `type`, `enum` or `const`.',
	],
	open: [
		'which Zod ignores as a schema beside `patternProperties`',
		'Use `additionalProperties: false`, or describe the other keys with a pattern of their own.',
	],
	keyed: [
		'which is joined with a branch, where Zod refuses a key only when both sides do, so other keys get through',
		"Declare every branch's properties on one object with no branch in or beside it, and close or limit that object.",
	],
	default: [
		'which Zod fills in at the root, in a branch, in `$defs` or in `prefixItems`, where it can stand in for a required value',
		'Put the `default` on a property outside those, or remove it.',
	],
	pattern: [
		'which Zod compiles without the `u` flag, so it matches differently',
		'Write a pattern valid with and without the `u` flag, with no `\\p`, `\\u{`, surrogate or character beyond U+FFFF.',
	],
	$ref: [
		"which Zod resolves only as `#` or `#/$defs/<name>`, an entry of the root's `$defs`",
		"Name an entry of the root's `$defs` as `#/$defs/<name>`.",
	],
	cycle: [
		'which reaches itself again through references and branches alone, so Zod never stops parsing',
		'Let the reference recur only below a keyword that moves into the input, such as `properties` or `items`.',
	],
	closed: [
		'which reaches an object closed by `additionalProperties: false` or `propertyNames` on one side of a join, where Zod refuses a key only when both sides do, so other keys get through',
		"Declare the entry's properties on the object that uses it, with no branch, and close that object; or leave the entry open.",
	],
	inherited: [
		'which names `{}`, a member every JavaScript object inherits, so Zod reads the inherited one when the key is missing',
		'Rename `{}` to a name no JavaScript object inherits.',
	],
	$schema: [
		'which names a draft other than 2020-12, which Zod reads otherwise',
		'Use `https://json-schema.org/draft/2020-12/schema`, or remove `$schema`.',
	],
	$id: [
		'which Zod ignores, resolving every `$ref` from the root',
		"Remove it, and keep shared subschemas in the root's `$defs`.",
	],
	format: [
		'which Zod checks by definitions of its own, where JSON Schema only annotates',
		'Remove it, and state the form with `pattern`.',
	],
	nullable: [
		'which Zod ignores in draft 2020-12',
		'Use a `type` list with `"null"`, such as `["string", "null"]`.',
	],
	$dynamicRef: ['which Zod ignores', "Use `$ref` to an entry of the root's `$defs`."],
};

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (node: Node, key: string): boolean => node[key] !== undefined;

/** Each subschema of `node` where Zod's converter reads one: it, the keyword it sits under, its path. */
function subschemas(node: Node): [child: unknown, keyword: string, path: string][] {
	const found: [unknown, string, string][] = [];
	for (const [key, value] of Object.entries(node)) {
		if (['additionalProperties', 'propertyNames', 'items', 'contains'].includes(key))
			found.push([value, key, key]);
		else if (
			['properties', 'patternProperties', '$defs', 'definitions'].includes(key) &&
			isNode(value)
		) {
			for (const [name, child] of Object.entries(value)) {
				found.push([child, key, `${key}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`]);
			}
		} else if (['prefixItems', ...BRANCHES].includes(key) && Array.isArray(value)) {
			for (const [index, child] of value.entries()) found.push([child, key, `${key}/${index}`]);
		}
	}
	return found;
}

/**
 * A pattern that means the same with and without the `u` flag: one both compile, with no property escape,
 * code point escape or surrogate, literal or escaped, which a reading without the flag splits in two.
 */
function unicodeSafe(pattern: string): boolean {
	try {
		return (
			Boolean(new RegExp(pattern, 'u')) &&
			!/\\[pP]|\\u\{|\\u[dD][89a-fA-F]|[\uD800-\uDFFF]/.test(pattern)
		);
	} catch {
		return false;
	}
}

/** The first keyword of `schema` the kernel's validator would not honour, with its place, or undefined. */
export function unfaithful(schema: unknown): Refusal | undefined {
	const root = isNode(schema) ? schema : {};
	const defs = isNode(root.$defs) ? root.$defs : {};
	const target = (ref: string): unknown => {
		const name = ref.slice(8).replaceAll('~1', '/').replaceAll('~0', '~');
		return ref === '#' ? root : Object.hasOwn(defs, name) ? defs[name] : undefined;
	};
	// The references read at the same place in the input as `node`: its own, and its branches', whatever its type.
	const same = (node: unknown): string[] =>
		isNode(node)
			? [
					...(typeof node.$ref === 'string' ? [node.$ref] : []),
					...BRANCHES.flatMap((key) => list(node, key)).flatMap(same),
				]
			: [];
	// Whether `node`, or what it reaches through references and branches, refuses keys Zod would let through
	// on one side of a join.
	const closes = (node: unknown, seen: Set<unknown>): boolean => {
		if (!isNode(node) || seen.has(node)) return false;
		seen.add(node);
		return (
			node.additionalProperties === false ||
			(has(node, 'propertyNames') && node.propertyNames !== true) ||
			[
				...(typeof node.$ref === 'string' ? [target(node.$ref)] : []),
				...BRANCHES.flatMap((key) => list(node, key)),
			].some((child) => closes(child, seen))
		);
	};
	const typed = (node: Node): boolean =>
		['type', 'enum', 'const', 'not'].some((key) => node[key] !== undefined);
	const list = (node: Node, key: string): unknown[] => (Array.isArray(node[key]) ? node[key] : []);
	// Whether Zod's parse of `undefined` succeeds: a schema with nothing it reads, or branches that let it.
	const vague = (node: unknown, depth = 0): boolean => {
		if (!isNode(node)) return node === true;
		if (typed(node) || depth > 64) return false;
		const next = (child: unknown): boolean => vague(child, depth + 1);
		if (typeof node.$ref === 'string') return next(target(node.$ref));
		return (
			list(node, 'allOf').every(next) &&
			(!has(node, 'anyOf') || list(node, 'anyOf').some(next)) &&
			(!has(node, 'oneOf') || list(node, 'oneOf').filter(next).length === 1)
		);
	};
	// Whether Zod marks the schema optional: a check it runs apart, from a pipe, through `$ref` and unions.
	const lax = (node: unknown, depth = 0): boolean => {
		if (!isNode(node) || depth > 64) return false;
		const next = (child: unknown): boolean => lax(child, depth + 1);
		const types = [node.type ?? []].flat();
		if (types.length > 0)
			return (
				!BRANCHES.some((key) => has(node, key)) &&
				((types.includes('array') && (node.uniqueItems === true || has(node, 'contains'))) ||
					(types.includes('object') &&
						(['minProperties', 'maxProperties'].some((key) => has(node, key)) ||
							(has(node, 'propertyNames') && node.propertyNames !== true))))
			);
		if (has(node, 'enum') || has(node, 'const')) return false;
		if (typeof node.$ref === 'string') return next(target(node.$ref));
		const all = list(node, 'allOf');
		return (
			[...list(node, 'anyOf'), ...list(node, 'oneOf')].some(next) ||
			(all.length === 1 && next(all[0]))
		);
	};
	const acyclic = new Set<string>();
	const loops = (ref: string, open: Set<string>): boolean => {
		if (acyclic.has(ref)) return false;
		if (open.has(ref)) return true;
		open.add(ref);
		const looped = same(target(ref)).some((next) => loops(next, open));
		open.delete(ref);
		if (!looped) acyclic.add(ref);
		return looped;
	};

	/** `joined`: the node is one side of an intersection. `defaults`: a `default` here is honoured. */
	const walk = (
		node: unknown,
		path: string,
		joined: boolean,
		defaults: boolean
	): Refusal | undefined => {
		if (!isNode(node)) return undefined;
		const has = (key: string): boolean => node[key] !== undefined;
		const at = (key: string, why: string, name = ''): Refusal => {
			const [problem, remedy] = WHY[why] as Refusal;
			return [
				`\`${key}\` at \`${path || '/'}\`, ${problem.replaceAll('{}', name)}`,
				remedy.replaceAll('{}', name),
			];
		};
		const types = [node.type ?? []].flat();
		const lone = ['$ref', 'enum', 'const'].find(has);
		const branches = BRANCHES.filter(has);
		const ref = typeof node.$ref === 'string' ? node.$ref : '';
		// Each keyword Zod reads its own way, and when.
		const found = Object.entries({
			$schema: node.$schema !== 'https://json-schema.org/draft/2020-12/schema',
			$id: path,
			default: !(defaults && path),
			format: true,
			nullable: true,
			$dynamicRef: true,
		}).find(([name, when]) => has(name) && when)?.[0];
		if (found) return at(found, found);
		const patterns = Object.keys(isNode(node.patternProperties) ? node.patternProperties : {});
		if (has('pattern') && !unicodeSafe(String(node.pattern))) return at('pattern', 'pattern');
		if (!patterns.every(unicodeSafe)) return at('patternProperties', 'pattern');
		if (has('$ref') && (!/^#(\/\$defs\/[^/%]+)?$/.test(ref) || target(ref) === undefined))
			return at('$ref', '$ref');
		if (ref && loops(ref, new Set())) return at('$ref', 'cycle');
		const beside =
			lone === '$ref' ? ['type', 'enum', 'const', ...BRANCHES] : lone === 'enum' ? ['const'] : [];
		const key = lone ? [...TYPED, ...beside].find(has) : types.length === 0 && TYPED.find(has);
		if (key) {
			const why =
				lone === '$ref' ? 'ref' : lone ? 'value' : TYPED.indexOf(key) < 7 ? 'object' : 'untyped';
			return at(key, why, lone ?? key);
		}
		if (!types.length && !lone && branches[1]) return at(branches[1], 'branches', branches[0]);
		const odd = (value: unknown): boolean => {
			const type = value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
			return (
				type === 'object' ||
				(types.length > 0 &&
					!types.includes(type) &&
					!(type === 'integer' && types.includes('number')))
			);
		};
		if (
			(lone === 'enum' ? (node.enum as unknown[]) : lone === 'const' ? [node.const] : []).some(odd)
		)
			return at(lone as string, 'values');
		if (joined && ref && closes(target(ref), new Set())) return at('$ref', 'closed');
		const properties = isNode(node.properties) ? node.properties : {};
		const required = (node.required as string[] | undefined) ?? [];
		const inherited = [...Object.keys(properties), ...required].find(
			(name) => name in Object.prototype && name !== '__proto__'
		);
		if (inherited !== undefined)
			return at(
				Object.hasOwn(properties, inherited) ? 'properties' : 'required',
				'inherited',
				inherited
			);
		for (const name of required) {
			if (!Object.hasOwn(properties, name)) return at('required', 'undeclared', name);
			if ((properties[name] as Node | null)?.default !== undefined)
				return at('required', 'defaulted', name);
		}
		const short = list(node, 'prefixItems')
			.slice(0, Number(node.minItems ?? 0))
			.some((item) => vague(item) && (node.items !== false || lax(item)));
		if (short) return at('prefixItems', 'padded');
		const counted = !has('items') && !has('prefixItems') && ['minItems', 'maxItems'].find(has);
		if (types.includes('array') && counted) return at(counted, 'items');
		if (has('patternProperties') && isNode(node.additionalProperties))
			return at('additionalProperties', 'open');
		const keyed =
			node.additionalProperties === false
				? 'additionalProperties'
				: has('propertyNames') && node.propertyNames !== true && 'propertyNames';
		if (keyed && (joined || branches.length > 0)) return at(keyed, 'keyed');
		const explicit = types.length > 0 || has('enum') || has('const');
		for (const [child, keyword, where] of subschemas(node)) {
			const branch = BRANCHES.includes(keyword);
			// Zod reads a key's schema with no `type` as a string's, unless it reads that schema alone.
			const keys =
				keyword === 'propertyNames' &&
				isNode(child) &&
				!['type', '$ref', 'enum', 'const'].some((name) => child[name] !== undefined);
			const problem = walk(
				keys ? { type: 'string', ...child } : child,
				`${path}/${where}`,
				keyword === 'allOf' || (branch && (explicit || joined)),
				defaults && !branch && !['prefixItems', '$defs', 'definitions'].includes(keyword)
			);
			if (problem) return problem;
		}
		// After the children, whose own refusal of a property's schema says more.
		const missing = required.find((name) => lax(properties[name]) && vague(properties[name]));
		if (missing !== undefined) return at('required', 'missing', missing);
		return undefined;
	};
	return walk(schema, '', false, true);
}
