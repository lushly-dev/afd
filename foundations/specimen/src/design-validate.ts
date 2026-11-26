import type { DesignStatesRequest } from './design-types.js';

type Fields = Record<string, unknown>;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Fields {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	for (const key of Object.keys(value))
		if (!keys.includes(key)) fail(path, `unrecognized key "${key}"`);
	return value as Fields;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length < 1) fail(path, 'expected a non-empty string');
	return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
		fail(path, `expected an integer from ${min} to ${max}`);
	return value;
}

/** Zero-Zod validation for `design-states` requests; held equal to `designStatesRequestSchema`. */
export function parseDesignStatesRequest(value: unknown): DesignStatesRequest {
	const path = 'design-states request';
	const fields = record(value, path, [
		'commands',
		'scenario',
		'consumer',
		'includeProposed',
		'limit',
		'after',
	]);
	const request: DesignStatesRequest = {};
	if (fields.commands !== undefined) {
		if (!Array.isArray(fields.commands)) fail(`${path}.commands`, 'expected an array of strings');
		request.commands = fields.commands.map((item, index) =>
			text(item, `${path}.commands[${index}]`)
		);
	}
	if (fields.scenario !== undefined) {
		request.scenario = text(fields.scenario, `${path}.scenario`);
	}
	if (fields.consumer !== undefined) {
		request.consumer = text(fields.consumer, `${path}.consumer`);
	}
	if (fields.includeProposed !== undefined) {
		if (typeof fields.includeProposed !== 'boolean')
			fail(`${path}.includeProposed`, 'expected a boolean');
		request.includeProposed = fields.includeProposed;
	}
	if (fields.limit !== undefined) {
		request.limit = integer(fields.limit, `${path}.limit`, 1, 500);
	}
	if (fields.after !== undefined) {
		request.after = text(fields.after, `${path}.after`);
	}
	return request;
}
