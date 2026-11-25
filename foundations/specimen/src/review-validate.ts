import type { ReviewRequest } from './review-types.js';

function fail(path: string, message: string): never {
	throw new Error(`${path}: ${message}`);
}

function record(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		fail(path, 'must be a JSON object');
	const fields = value as Record<string, unknown>;
	for (const key of Object.keys(fields)) {
		if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown option');
	}
	return fields;
}

function nonEmptyText(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string');
	return value.trim();
}

export function parseReviewRequest(value: unknown): ReviewRequest {
	const path = 'review request';
	const fields = record(value, path, ['before', 'after', 'ids']);
	const before = nonEmptyText(fields.before, `${path}.before`);
	const after = nonEmptyText(fields.after, `${path}.after`);
	let ids: string[] | undefined;
	if (fields.ids !== undefined) {
		if (!Array.isArray(fields.ids)) fail(`${path}.ids`, 'must be an array of strings');
		if (fields.ids.length === 0) fail(`${path}.ids`, 'must contain at least one id when provided');
		const seen = new Set<string>();
		ids = [];
		for (let i = 0; i < fields.ids.length; i++) {
			const id = nonEmptyText(fields.ids[i], `${path}.ids[${i}]`);
			if (seen.has(id)) fail(`${path}.ids[${i}]`, `duplicate id: ${id}`);
			seen.add(id);
			ids.push(id);
		}
	}
	return {
		before,
		after,
		...(ids !== undefined ? { ids } : {}),
	};
}
