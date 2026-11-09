import { describe, expect, it } from 'vitest';
import {
	type AppDefinitionV1,
	defineApp,
	failure,
	KIT_ELEMENT_NAMES_V1,
	SDK_VERSION,
	success,
} from './index.js';

describe('the SDK root', () => {
	it('returns the definition it is given', () => {
		const definition: AppDefinitionV1 = {
			sdk: 1,
			handlers: { 'hello-ping': async () => success({ pong: true }) },
		};
		expect(defineApp(definition)).toBe(definition);
		expect(SDK_VERSION).toBe(1);
	});

	it('lets a handler type its input', async () => {
		const definition = defineApp({
			sdk: 1,
			handlers: {
				'hello-greet': async (input: { name: string }) => success(`Hello, ${input.name}!`),
			},
		});
		const handler = definition.handlers['hello-greet'] as unknown as (
			input: unknown
		) => Promise<{ data?: unknown }>;
		expect((await handler({ name: 'Ada' })).data).toBe('Hello, Ada!');
	});

	it('re-exports the result helpers, so an app imports no AFD server code', () => {
		expect(success(1)).toEqual({ success: true, data: 1 });
		const error = { code: 'NOPE', message: 'No.', suggestion: 'Stop.' };
		expect(failure(error)).toEqual({ success: false, error });
	});

	it('lists the kit named by the specification', () => {
		expect(KIT_ELEMENT_NAMES_V1).toHaveLength(14);
		expect(KIT_ELEMENT_NAMES_V1).toContain('loam-list');
		// The documents specification's 9.2: an editor embeds another document by name.
		expect(KIT_ELEMENT_NAMES_V1).toContain('loam-embed');
	});
});
