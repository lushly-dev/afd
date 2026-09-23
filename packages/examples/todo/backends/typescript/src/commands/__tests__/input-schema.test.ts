/**
 * Advertised input schemas describe what a caller may send: fields with defaults
 * are optional.
 */

import { describe, expect, it } from 'vitest';
import { allCommands, listTodos } from '../index.js';

describe('advertised input schemas', () => {
	it('todo-list requires none of its defaulted or optional fields', () => {
		expect(listTodos.jsonSchema.required).toBeUndefined();
		expect(listTodos.jsonSchema.properties?.limit).toMatchObject({ type: 'integer', default: 20 });
	});

	it('never lists a defaulted field as required', () => {
		for (const command of allCommands) {
			const required = Array.isArray(command.jsonSchema.required)
				? command.jsonSchema.required
				: [];
			for (const [field, schema] of Object.entries(command.jsonSchema.properties ?? {})) {
				if (schema.default !== undefined) {
					expect(required, `${command.name}.${field}`).not.toContain(field);
				}
			}
		}
	});
});
