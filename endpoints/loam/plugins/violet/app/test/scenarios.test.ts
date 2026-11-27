/**
 * @fileoverview Exit criterion 1: runs all 15 JTBD scenarios in `scenarios/` (including the 10
 * `slice`-tagged scenarios) against `createAppTestKernel`, plus deterministic `replay()` on each
 * scenario (spec §9.1).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateResult, parseScenarioFile, resolveStepReferences } from '@lushly-dev/afd-testing';
import { readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { PINNED_INTERFACE } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIOS_DIR = join(ROOT, 'scenarios');
const SCENARIO_TIMEOUT_MS = 20_000;

const scenarioFiles = readdirSync(SCENARIOS_DIR)
	.filter((file) => file.endsWith('.scenario.yaml'))
	.sort();

const importNative = () => import('../src/native.js');

describe('violet-tree JTBD scenarios (spec §9.1)', () => {
	let manifest: Awaited<ReturnType<typeof readAppManifest>>;
	let nativeDefinition: Awaited<ReturnType<typeof importNative>>;

	// Cold-load the manifest, native module graph, and one test kernel outside any individual
	// scenario's timeout so host load does not spend the first scenario's budget on startup (#2805).
	beforeAll(async () => {
		[manifest, nativeDefinition] = await Promise.all([readAppManifest(ROOT), importNative()]);
		const warm = await createAppTestKernel({
			manifest,
			definition: () => Promise.resolve(nativeDefinition),
			config: { interface: PINNED_INTERFACE },
		});
		await warm.kernel.dispose();
	}, 30_000);

	it('discovers all 15 scenario files including 10 slice-tagged scenarios', async () => {
		expect(scenarioFiles).toHaveLength(15);
		let sliceCount = 0;
		for (const file of scenarioFiles) {
			const parsed = await parseScenarioFile(join(SCENARIOS_DIR, file));
			expect(parsed.success, file).toBe(true);
			if (parsed.success && parsed.scenario.tags?.includes('slice')) {
				sliceCount++;
			}
		}
		expect(sliceCount).toBe(10);
	});

	for (const file of scenarioFiles) {
		it(
			`passes ${file} and replays deterministically`,
			async () => {
				const parsed = await parseScenarioFile(join(SCENARIOS_DIR, file));
				if (!parsed.success) {
					throw new Error(`Failed to parse ${file}: ${parsed.error}`);
				}
				const scenario = parsed.scenario;
				const { kernel, replay } = await createAppTestKernel({
					manifest,
					definition: () => Promise.resolve(nativeDefinition),
					config: { interface: PINNED_INTERFACE },
				});

				try {
					const stepOutputs: Array<Awaited<ReturnType<typeof kernel.call>>> = [];

					for (let index = 0; index < scenario.steps.length; index++) {
						const step = scenario.steps[index];
						if (!step) continue;
						const resolvedInput = step.input ? resolveStepReferences(step.input, stepOutputs) : {};
						const result = await kernel.call(step.command, resolvedInput);
						const evaluation = evaluateResult(result, step.expect);
						if (!evaluation.passed) {
							const failures = evaluation.assertions
								.filter((a) => !a.passed)
								.map(
									(a) =>
										`${a.path}: ${a.description} (expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)})`
								)
								.join('\n  ');
							throw new Error(
								`${file} step ${index} (${step.command} — ${step.description ?? ''}) failed:\n  ${failures}\nFull result: ${JSON.stringify(result, null, 2)}`
							);
						}
						stepOutputs.push(result);
					}

					const replayed = await replay();
					expect(replayed.report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
				} finally {
					await kernel.dispose();
				}
			},
			SCENARIO_TIMEOUT_MS
		);
	}
});
