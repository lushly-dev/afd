/**
 * The language-neutral vectors in `spec/vectors/pipeline-variables.json`.
 *
 * The file is generated from this implementation, so a failure here means either an unintended
 * behavior change or a stale file. Python, Rust and C++ load the same file (see
 * `spec/vectors/README.md`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PipelineCondition, PipelineContext, StepResult } from './pipeline.js';
import { evaluateCondition, resolveVariable, resolveVariables } from './pipeline-variables.js';

interface VectorStep {
	index: number;
	alias?: string;
	status: 'success' | 'failure';
	data?: unknown;
}

interface Vectors {
	context: { input: Record<string, unknown>; steps: VectorStep[]; previous: number };
	references: Array<{ reference: string; resolved: boolean; value?: unknown }>;
	conditions: Array<{ condition: PipelineCondition; expected: boolean }>;
}

const vectors: Vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/pipeline-variables.json', import.meta.url), 'utf8')
);

function contextFrom(spec: Vectors['context']): PipelineContext {
	const steps: StepResult[] = spec.steps.map((step) => ({
		...step,
		command: `step-${step.index}`,
		executionTimeMs: 0,
	}));
	return { pipelineInput: spec.input, steps, previousResult: steps[spec.previous] };
}

const context = contextFrom(vectors.context);

/** A short, printable test name: some references are 1024 characters or hold a no-break space. */
function label(text: string): string {
	const printable = JSON.stringify(text);
	return printable.length > 60 ? `${printable.slice(0, 40)}... (${text.length} chars)` : printable;
}

describe('spec/vectors/pipeline-variables.json', () => {
	it('has the expected number of cases', () => {
		expect(vectors.references.length).toBeGreaterThanOrEqual(40);
		expect(vectors.conditions.length).toBeGreaterThanOrEqual(20);
	});

	it.each(vectors.references.map((vector) => [label(vector.reference), vector] as const))(
		'reference %s',
		(_label, { reference, resolved, value }) => {
			const result = resolveVariable(reference, context);
			// Inside a step input, an unresolved reference is omitted from its object.
			const input = resolveVariables({ value: reference }, context) as Record<string, unknown>;
			if (resolved) {
				expect(result).toEqual(value);
				expect(input).toEqual({ value });
			} else {
				expect(result).toBeUndefined();
				expect(input).toEqual({});
			}
		}
	);

	it.each(vectors.conditions.map((vector) => [JSON.stringify(vector.condition), vector] as const))(
		'condition %s',
		(_label, { condition, expected }) => {
			expect(evaluateCondition(condition, context)).toBe(expected);
		}
	);
});
