/**
 * @fileoverview An input's size against a limit (phase 4 specification, section 11), apart from `confirmation-parts.ts`
 * so `late` reads it without that module, which the confirmations' chunk holds.
 */

/**
 * Whether an input is over `bound` bytes as JSON now, or has no JSON form (phase 4's section 11's R2), measured here
 * rather than with first paint's `measureJson`, whose import would part first paint's chunks. No bound: never over.
 */
export function overBound(bound: number | undefined, input: unknown): boolean {
	if (bound === undefined) return false;
	try {
		const json = JSON.stringify(input);
		return json === undefined || new TextEncoder().encode(json).length > bound;
	} catch {
		return true;
	}
}
