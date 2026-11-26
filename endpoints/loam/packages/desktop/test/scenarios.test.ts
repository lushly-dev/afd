/**
 * P5-A1 on the desktop (phase 5 specification, 18): every slice file, run by the kernel's own runner
 * (`kernel/scenarios/runner.ts`, its directives read as in the units and in Chromium) against the app under
 * `tauri-driver`. Each file starts the app on a fresh data directory, so a fresh store and a fresh `mailfix` process, on
 * its seed (`fixtures/p5-base.ts`). The copilot runs in its production frame, its model reached through the Rust host's
 * `model_send` (`fixtures/scenario-model.ts`); `mailfix` is a `stdio` instance on MCP 2026-07-28 that names the Rust
 * host its approver, so the two files a mounted approval needs, which Chromium cannot run (7.2), run here.
 *
 * What it does not prove: a model's judgment (the scripts choose), the seed's fixed projects and documents (made by no
 * slice file's step), or macOS, whose suite is `test:macos`. Every wait is a poll with a deadline.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { namesTagged, readScenario, runScenario, seedOf } from '../../kernel/scenarios/runner.ts';
import { desktopHost, p5Deployment, seedDesktop } from './fixtures/p5-base';
import { type ScenarioModel, startScenarioModel } from './fixtures/scenario-model';
import { type Desktop, openDesktop } from './harness';

const PHASE_5 = fileURLToPath(
	new URL('../../../docs/phases/5-copilot/scenarios/', import.meta.url)
);
const SLICE = namesTagged(PHASE_5, 'slice');

let model: ScenarioModel;
let desktop: Desktop | undefined;

beforeAll(async () => {
	model = await startScenarioModel();
});

afterAll(async () => {
	await desktop?.close();
	await model?.close();
});

describe("P5-A1: the slice's scenarios on the desktop", () => {
	it('P5-A1: runs all nine slice files, the two a mounted approval needs among them', () => {
		expect(SLICE).toHaveLength(9);
		expect(SLICE).toEqual(expect.arrayContaining(['approve-mail-send', 'person-sends-mail']));
	});

	for (const name of SLICE) {
		it(`P5-A1: passes ${name}`, async () => {
			const scenario = readScenario(PHASE_5, `${name}.scenario.yaml`);
			desktop = await openDesktop({
				deployment: await p5Deployment(seedOf(scenario, 'p5-base'), model),
			});
			try {
				// A step waits for its turn to settle, up to the kernel's 50 s, past WebDriver's default 30 s for a script.
				await desktop.browser.setTimeout({ script: 120_000 });
				await seedDesktop(desktop);
				const { passed, detail } = await runScenario(scenario, desktopHost(desktop));
				expect(passed, detail).toBe(true);
			} finally {
				await desktop.close();
				desktop = undefined;
			}
		}, 240_000);
	}
});
