/**
 * @fileoverview The command surface passes AFD's strict surface validation, as
 * `afd validate --surface --strict` would report it for a connected server.
 */

import { validateCommandSurface } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { allCommands } from './commands/index.js';
import { SURFACE_SUPPRESSIONS } from './surface-suppressions.js';

describe('the command surface', () => {
	it('passes strict surface validation', () => {
		const result = validateCommandSurface(allCommands, {
			strict: true,
			suppressions: [...SURFACE_SUPPRESSIONS],
		});
		const problems = result.findings
			.filter((finding) => !finding.suppressed && finding.severity !== 'info')
			.map((finding) => `${finding.rule}: ${finding.message}`);
		expect(problems).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it('reports no undeclared mutation (spec/idempotency.md, D4)', () => {
		const result = validateCommandSurface(allCommands);
		expect(result.summary.rulesEvaluated).toContain('missing-idempotency');
		expect(result.findings.filter((finding) => finding.rule === 'missing-idempotency')).toEqual([]);
	});

	it('declares a title, an output and an example on every command', () => {
		for (const command of allCommands) {
			expect(command.title, command.name).toBeTruthy();
			expect(command.outputSchema, command.name).toBeDefined();
			expect(command.examples?.length, command.name).toBeGreaterThan(0);
		}
	});

	it('declares an approval policy on every mutation', () => {
		for (const command of allCommands.filter((command) => command.mutation)) {
			expect(command.approval, command.name).toBeDefined();
		}
	});
});
