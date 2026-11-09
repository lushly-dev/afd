/**
 * @fileoverview Where Zod's `fromJSONSchema`, the kernel's validator of an app's input, config and document
 * content, would not honour a schema it accepts, read from Zod's converter and held to Ajv by
 * `schema-fidelity.test.ts` (phase 1 specification, `input-schema`; documents specification, Follow-ups):
 *
 * - it reads a type's keywords only under that `type`, so a branch with `required` and no `type` checks nothing;
 * - it reads `$ref`, `enum` and `const` alone, ignoring a type's keywords beside them, and compares an object
 *   or array value by identity, so it never matches;
 * - it requires only a property `properties` declares, and fills in a `default`;
 * - an intersection, which `allOf` or a branch beside `type` makes, refuses a key only when both sides do, so
 *   `additionalProperties: false` and `propertyNames` there let keys through, and two defaults there throw;
 * - with no `type`, a second of `allOf`, `anyOf` and `oneOf` replaces the first;
 * - it compiles `pattern` without the `u` flag, so `\p{L}` is a `p`;
 * - it checks `format` by definitions of its own, ignores `nullable`, `$dynamicRef`, a nested `$id` and
 *   `additionalProperties` beside `patternProperties` unless it is `false`, and reads draft 2020-12 only.
 */

type Node = Record<string, unknown>;

/** The keywords Zod reads only under the `type` it converts; `$ref`, `enum` and `const` read alone. */
const TYPED =
	'properties required additionalProperties patternProperties propertyNames minProperties maxProperties items prefixItems contains minItems maxItems uniqueItems minContains maxContains minLength maxLength pattern minimum maximum exclusiveMinimum exclusiveMaximum multipleOf'.split(
		' '
	);
const BRANCHES = ['allOf', 'anyOf', 'oneOf'];

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

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

/** A `pattern` that means the same with and without the `u` flag, as far as a reading can tell. */
function unicodeSafe(pattern: string): boolean {
	try {
		return Boolean(new RegExp(pattern, 'u')) && !/\\[pP]|\\u\{/.test(pattern);
	} catch {
		return false;
	}
}

/**
 * The first keyword of `node` the kernel's validator would not honour, with its place, or undefined.
 * `joined`: the node is one side of an intersection. `defaults`: a `default` here is honoured.
 */
export function unfaithful(
	node: unknown,
	path = '',
	joined = false,
	defaults = true
): string | undefined {
	if (!isNode(node)) return undefined;
	const has = (key: string): boolean => node[key] !== undefined;
	const at = (key: string, why: string): string =>
		`\`${key}\` at \`${path || '/'}\`, which Zod ${why}`;
	const types = [node.type ?? []].flat();
	const lone = ['$ref', 'enum', 'const'].find(has);
	const branches = BRANCHES.filter(has);
	// Each keyword Zod reads its own way, and when.
	const found = Object.entries({
		$schema: node.$schema !== 'https://json-schema.org/draft/2020-12/schema',
		$id: path,
		pattern: !unicodeSafe(String(node.pattern)),
		default: !defaults,
		format: true,
		nullable: true,
		$dynamicRef: true,
	}).find(([name, when]) => has(name) && when)?.[0];
	if (found) return at(found, 'reads its own way here');
	const beside =
		lone === '$ref' ? ['type', 'enum', 'const', ...BRANCHES] : lone === 'enum' ? ['const'] : [];
	const key = lone
		? [...TYPED, ...beside].find(has)
		: types.length === 0 && (TYPED.find(has) ?? branches[1]);
	if (key) return at(key, lone ? `ignores beside \`${lone}\`` : 'ignores with no `type`');
	const odd = (value: unknown): boolean => {
		const type = value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
		return (
			type === 'object' ||
			(types.length > 0 &&
				!types.includes(type) &&
				!(type === 'integer' && types.includes('number')))
		);
	};
	if ((lone === 'enum' ? (node.enum as unknown[]) : lone === 'const' ? [node.const] : []).some(odd))
		return at(
			lone as string,
			'reads apart from `type`, and never matches an object or an array in it'
		);
	const properties = isNode(node.properties) ? node.properties : {};
	const name = ((node.required as string[] | undefined) ?? []).find(
		(name) =>
			!Object.hasOwn(properties, name) || (properties[name] as Node | null)?.default !== undefined
	);
	if (name !== undefined)
		return at('required', `does not apply to \`${name}\`, which \`properties\` lacks or defaults`);
	if (has('patternProperties') && isNode(node.additionalProperties))
		return at('additionalProperties', 'ignores as a schema beside `patternProperties`');
	const keyed =
		node.additionalProperties === false
			? 'additionalProperties'
			: has('propertyNames') && node.propertyNames !== true && 'propertyNames';
	if (keyed && (joined || branches.length > 0))
		return at(keyed, 'lets other keys through in or beside a branch');
	const explicit = types.length > 0 || has('enum') || has('const');
	for (const [child, keyword, where] of subschemas(node)) {
		const branch = BRANCHES.includes(keyword);
		// Zod reads a key's schema with no `type` as a string's.
		const keys = keyword === 'propertyNames' && isNode(child) && child.type === undefined;
		const problem = unfaithful(
			keys ? { type: 'string', ...child } : child,
			`${path}/${where}`,
			keyword === 'allOf' || (branch && explicit),
			defaults && !branch && keyword[0] !== '$' && keyword !== 'definitions'
		);
		if (problem) return problem;
	}
	return undefined;
}
