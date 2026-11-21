import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScenarioString } from '@lushly-dev/afd-testing';
import { afterEach, describe, expect, it } from 'vitest';
import { findScenarioFiles, SAMPLE_SCENARIO } from './scenario-files.js';

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scenario init sample', () => {
	it('parses with the scenario parser that `afd scenario run` uses', () => {
		const result = parseScenarioString(SAMPLE_SCENARIO);
		expect(result.success ? result.scenario.steps.map((step) => step.command) : result).toEqual([
			'todo-create',
			'todo-toggle',
			'todo-list',
		]);
	});
});

describe('findScenarioFiles (#1708)', () => {
	it('discovers scenario files in directories, metacharacter directories, and globs', async () => {
		const root = await mkdtemp(join(tmpdir(), 'afd-scenarios-'));
		dirs.push(root);
		const nested = join(root, 'suite[1]', 'nested');
		await mkdir(nested, { recursive: true });
		const first = join(nested, 'a.scenario.yaml');
		const second = join(nested, 'b.scenario.yaml');
		await writeFile(first, SAMPLE_SCENARIO);
		await writeFile(second, SAMPLE_SCENARIO);

		expect(await findScenarioFiles(root)).toEqual([first, second].sort());
		expect(await findScenarioFiles(join(root, 'suite[1]'))).toEqual([first, second].sort());
		expect(await findScenarioFiles(first)).toEqual([first]);
		expect(await findScenarioFiles(join(root, '**', '*.scenario.yaml'))).toEqual(
			[first, second].sort()
		);
		expect(await findScenarioFiles(join(nested, '?.scenario.yaml'))).toEqual(
			[first, second].sort()
		);
		expect(await findScenarioFiles(join(root, 'suite[1]', '**', '*.scenario.yaml'))).toEqual(
			[first, second].sort()
		);
	});
});
