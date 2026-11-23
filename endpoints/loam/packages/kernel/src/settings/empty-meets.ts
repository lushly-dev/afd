/**
 * @fileoverview Whether `{}` meets a mounted command's advertised input schema (phase 4 specification, 8.3; step 7's
 * R11), in the late chunk: a chord runs a mounted command with `{}`, and its schema meets no manifest rule.
 */

/** The keywords decided for `{}`: an empty object has no property, so `properties` and `additionalProperties` hold. */
const DECIDED = new Set([
	'type',
	'required',
	'minProperties',
	'properties',
	'additionalProperties',
	'allOf',
	'anyOf',
	'oneOf',
]);

/** Annotations, which assert nothing (JSON Schema's meta-data vocabulary and the core's identifiers). */
const ANNOTATIONS = new Set([
	'$schema',
	'$id',
	'$comment',
	'title',
	'description',
	'default',
	'examples',
	'deprecated',
	'readOnly',
	'writeOnly',
]);

/** True or false where `schema`'s keywords decide whether `{}` meets it; undefined where they do not. */
function decide(schema: unknown): boolean | undefined {
	if (typeof schema === 'boolean') return schema;
	if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return undefined;
	const shape = schema as Record<string, unknown>;
	const keys = Object.keys(shape);
	if (keys.some((key) => !DECIDED.has(key) && !ANNOTATIONS.has(key))) return undefined;
	const answers: Array<boolean | undefined> = [];
	if ('type' in shape) {
		const types = [shape.type].flat();
		if (types.length === 0 || types.some((type) => typeof type !== 'string')) return undefined;
		answers.push(types.includes('object'));
	}
	if ('required' in shape)
		answers.push(Array.isArray(shape.required) ? shape.required.length === 0 : undefined);
	if ('minProperties' in shape)
		answers.push(typeof shape.minProperties === 'number' ? shape.minProperties <= 0 : undefined);
	if ('properties' in shape)
		answers.push(
			typeof shape.properties === 'object' && shape.properties !== null ? true : undefined
		);
	if ('additionalProperties' in shape)
		answers.push(
			typeof shape.additionalProperties === 'boolean' ||
				(typeof shape.additionalProperties === 'object' && shape.additionalProperties !== null)
				? true
				: undefined
		);
	const branches = (key: string): Array<boolean | undefined> | undefined => {
		const list = shape[key];
		return Array.isArray(list) && list.length > 0 ? list.map(decide) : undefined;
	};
	if ('allOf' in shape) {
		const each = branches('allOf');
		answers.push(each === undefined ? undefined : all(each));
	}
	if ('anyOf' in shape) {
		const each = branches('anyOf');
		answers.push(
			each === undefined
				? undefined
				: each.includes(true)
					? true
					: each.includes(undefined)
						? undefined
						: false
		);
	}
	if ('oneOf' in shape) {
		// Counted only when every branch is decided: an undecidable one could be the second match.
		const each = branches('oneOf');
		answers.push(
			each === undefined || each.includes(undefined)
				? undefined
				: each.filter((met) => met).length === 1
		);
	}
	return all(answers);
}

/** False if any is, else undefined if any is, else true. */
function all(answers: ReadonlyArray<boolean | undefined>): boolean | undefined {
	if (answers.includes(false)) return false;
	return answers.includes(undefined) ? undefined : true;
}

/**
 * Whether `{}` is proven to meet `schema`: every keyword decided and met, `oneOf` exactly once (the fourth round's 3).
 * Any other keyword where it must decide (`$ref`, `$defs`, `not`, `enum`, `const`, `if`, an unknown one) makes it
 * false, as does a `oneOf` with a branch it cannot decide: a mounted command it is not sure of gets no shortcut
 * (step 7's R11). Annotations, such as `$schema` and `description`, assert nothing and are passed over.
 */
export function emptyMeets(schema: unknown): boolean {
	return decide(schema) === true;
}
