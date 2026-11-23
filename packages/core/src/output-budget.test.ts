import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	AFD_OUTPUT_BUDGET_META_KEY,
	commandToMcpTool,
	createCommandRegistry,
	createContextDigest,
	isJournalEntry,
	MAX_OUTPUT_BUDGET_BYTES,
	type OutputBudget,
	parseJournal,
	serializeJournal,
	success,
} from './index.js';
import { validateOutputBudget } from './output-budget.js';

interface DeclarationCase {
	description: string;
	value: unknown;
	valid: boolean;
}

const cases = JSON.parse(
	readFileSync(new URL('../../../spec/output-budgets.json', import.meta.url), 'utf8')
) as { declarations: DeclarationCase[] };

describe('output budget declarations (B1)', () => {
	it('validates every declaration case from spec/output-budgets.json', () => {
		expect(cases.declarations.length).toBeGreaterThanOrEqual(12);
		for (const testCase of cases.declarations) {
			if (testCase.valid) {
				expect(validateOutputBudget(testCase.value, 'doc-search'), testCase.description).toEqual(
					testCase.value
				);
			} else {
				expect(
					() => validateOutputBudget(testCase.value, 'doc-search'),
					testCase.description
				).toThrow(/doc-search.*outputBudget|outputBudget.*doc-search/);
			}
		}
	});

	it('validates declarations on createCommandRegistry.register and emits _meta["dev.afd/outputBudget"]', () => {
		const registry = createCommandRegistry();
		const mutableBudget = { defaultBytes: 64, maxBytes: 128 };
		const budgeted = {
			name: 'doc-search',
			description: 'Search documents',
			parameters: [],
			expose: { mcp: true },
			outputBudget: mutableBudget,
			handler: async () => success({ ok: true }),
		};
		registry.register(budgeted);
		mutableBudget.defaultBytes = 256;
		expect(registry.get('doc-search')?.outputBudget).toEqual({
			defaultBytes: 64,
			maxBytes: 128,
		});
		const tool = commandToMcpTool(registry.get('doc-search') ?? budgeted);
		expect(tool._meta?.[AFD_OUTPUT_BUDGET_META_KEY]).toEqual({
			defaultBytes: 64,
			maxBytes: 128,
		});

		const plain = {
			name: 'doc-open',
			description: 'Open document',
			parameters: [],
			expose: { mcp: true },
			handler: async () => success({ ok: true }),
		};
		registry.register(plain);
		expect(commandToMcpTool(plain)._meta).toBeUndefined();

		expect(() =>
			registry.register({
				name: 'doc-bad',
				description: 'Invalid budget',
				parameters: [],
				outputBudget: { defaultBytes: 128, maxBytes: 64 },
				handler: async () => success({ ok: true }),
			})
		).toThrow(/doc-bad.*outputBudget\.defaultBytes/);
	});

	it('exports MAX_OUTPUT_BUDGET_BYTES = 2^53 - 1 and AFD_OUTPUT_BUDGET_META_KEY', () => {
		expect(MAX_OUTPUT_BUDGET_BYTES).toBe(Number.MAX_SAFE_INTEGER);
		expect(AFD_OUTPUT_BUDGET_META_KEY).toBe('dev.afd/outputBudget');
		const budget: OutputBudget = { defaultBytes: 1, maxBytes: MAX_OUTPUT_BUDGET_BYTES };
		expect(validateOutputBudget(budget)).toEqual(budget);
	});
});

describe('output budget journal primitives (B8)', () => {
	it('leaves the context digest unchanged without outputBudget and includes it when set', async () => {
		const base = await createContextDigest({ traceId: 't-1', custom: 'x' });
		const explicitUndefined = await createContextDigest({
			traceId: 't-1',
			custom: 'x',
			outputBudget: undefined,
		});
		expect(explicitUndefined.hash).toBe(base.hash);

		const budgeted64 = await createContextDigest({
			traceId: 't-1',
			custom: 'x',
			outputBudget: 64,
		});
		const budgeted128 = await createContextDigest({
			traceId: 't-1',
			custom: 'x',
			outputBudget: 128,
		});
		expect(budgeted64.hash).not.toBe(base.hash);
		expect(budgeted64.hash).not.toBe(budgeted128.hash);
	});

	it('accepts valid outputBudget on JournalEntry and rejects invalid values', () => {
		const baseEntry = {
			seq: 1,
			timestamp: '2026-11-22T00:00:00.000Z',
			command: 'doc-search',
			input: {},
			contextDigest: { hash: 'sha256:abc' },
			result: { success: true, data: {} },
			durationMs: 1,
		};
		expect(isJournalEntry(baseEntry)).toBe(true);
		expect(isJournalEntry({ ...baseEntry, outputBudget: 64 })).toBe(true);
		expect(isJournalEntry({ ...baseEntry, outputBudget: MAX_OUTPUT_BUDGET_BYTES })).toBe(true);
		expect(isJournalEntry({ ...baseEntry, outputBudget: 0 })).toBe(false);
		expect(isJournalEntry({ ...baseEntry, outputBudget: -1 })).toBe(false);
		expect(isJournalEntry({ ...baseEntry, outputBudget: 1.5 })).toBe(false);
		expect(isJournalEntry({ ...baseEntry, outputBudget: '64' })).toBe(false);
		expect(isJournalEntry({ ...baseEntry, outputBudget: MAX_OUTPUT_BUDGET_BYTES + 1 })).toBe(false);

		const serialized = serializeJournal([{ ...baseEntry, outputBudget: 64 }]);
		expect(parseJournal(serialized)).toEqual([{ ...baseEntry, outputBudget: 64 }]);
	});
});
