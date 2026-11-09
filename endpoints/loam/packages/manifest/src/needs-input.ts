/**
 * @fileoverview Whether a command needs input, by its input schema's shape alone, with no validator, so the
 * kernel reads it in first paint (phase 1 specification, 4.2: a chord, a header action and the palette run
 * only a command that needs none). One predicate for the kernel and the manifest's rules, which add the
 * validator's own parse of `{}` (documents specification, 2.1: New calls a creator with `{}`).
 */

type Shape = {
	required?: unknown[];
	minProperties?: number;
	allOf?: unknown[];
	anyOf?: unknown[];
	oneOf?: unknown[];
};

/**
 * True when `{}` cannot meet the schema's shape: a `required` property or `minProperties` above 0 at its
 * root, in any `allOf` branch, or in every branch of an `anyOf` or `oneOf`, at any depth. An app's manifest
 * holds these in a branch only beside the branch's `type`, since the kernel's validator ignores them without
 * one, and `schema-fidelity.test.ts` holds this answer to that validator's on every schema the input-schema
 * rule accepts there; a mounted server's schema meets no such rule, so this stays the cautious answer.
 */
export const needsInputShape = (schema: unknown): boolean => {
	const shape = schema as Shape | null;
	return (
		typeof shape === 'object' &&
		shape !== null &&
		(Number(shape.required?.length) > 0 ||
			Number(shape.minProperties) > 0 ||
			(Array.isArray(shape.allOf) && shape.allOf.some(needsInputShape)) ||
			[shape.anyOf, shape.oneOf].some(
				(branches) =>
					Array.isArray(branches) && branches.length > 0 && branches.every(needsInputShape)
			))
	);
};
