import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { SpecimenHostError } from './host.js';

async function renderError(bench: SpecimenBench, id: string): Promise<SpecimenHostError> {
	const error = await bench.render({ id, checkpoint: 'after-run' }).then(
		() => {
			throw new Error(`Expected ${id} to fail target resolution`);
		},
		(value: unknown) => value
	);
	expect(error).toBeInstanceOf(Error);
	return error as SpecimenHostError;
}

describe.each(['in-process', 'process'] as const)(
	'typed target resolution errors (%s)',
	(runtimeIsolation) => {
		let root: string;
		let bench: SpecimenBench;

		beforeAll(async () => {
			root = await realpath(await mkdtemp(join(tmpdir(), `specimen-targets-${runtimeIsolation}-`)));
			await writeFile(
				join(root, 'toolbar.js'),
				`function renderToolbar() {
	const container = document.createElement('div');
	container.setAttribute('role', 'toolbar');
	for (const label of ['Share', 'Export']) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'action';
		button.dataset.action = label.toLowerCase();
		button.textContent = label;
		button.addEventListener('click', () => {
			container.dataset.clicked = label.toLowerCase();
		});
		container.append(button);
	}
	return container;
}

export const SelectorMissing = {
	render: renderToolbar,
	targets: { absent: { selector: '.does-not-exist' } },
	scenario: [{ action: { click: 'absent' } }],
};

export const SelectorSingle = {
	render: renderToolbar,
	targets: { share: { selector: 'button[data-action="share"]' } },
	scenario: [{ action: { click: 'share' } }],
};

export const SelectorAmbiguous = {
	render: renderToolbar,
	targets: { action: { selector: 'button.action' } },
	scenario: [{ action: { click: 'action' } }],
};

export const RoleMissing = {
	render: renderToolbar,
	targets: { print: { role: 'button', name: 'Print' } },
	scenario: [{ action: { click: 'print' } }],
};

export const RoleSingle = {
	render: renderToolbar,
	targets: { share: { role: 'button', name: 'Share' } },
	scenario: [{ action: { click: 'share' } }],
};

export const RoleAmbiguous = {
	render: renderToolbar,
	targets: { anyButton: { role: 'button' } },
	scenario: [{ action: { click: 'anyButton' } }],
};
`
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify({
					specimens: [
						{
							id: 'selector-missing',
							title: 'Selector missing',
							module: './toolbar.js',
							exportName: 'SelectorMissing',
						},
						{
							id: 'selector-single',
							title: 'Selector single',
							module: './toolbar.js',
							exportName: 'SelectorSingle',
						},
						{
							id: 'selector-ambiguous',
							title: 'Selector ambiguous',
							module: './toolbar.js',
							exportName: 'SelectorAmbiguous',
						},
						{
							id: 'role-missing',
							title: 'Role missing',
							module: './toolbar.js',
							exportName: 'RoleMissing',
						},
						{
							id: 'role-single',
							title: 'Role single',
							module: './toolbar.js',
							exportName: 'RoleSingle',
						},
						{
							id: 'role-ambiguous',
							title: 'Role ambiguous',
							module: './toolbar.js',
							exportName: 'RoleAmbiguous',
						},
					],
				})
			);
			bench = await createSpecimenBench({ root, runtimeIsolation });
		});

		afterAll(async () => {
			await bench?.close();
			if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
		});

		it('resolves zero, one, and multiple matches for { selector }', async () => {
			const notFound = await renderError(bench, 'selector-missing');
			expect(notFound.code).toBe('TARGET_NOT_FOUND');
			expect(notFound.message).toContain("Target 'absent'");
			expect(notFound.suggestion).toContain('review page');
			expect(notFound.details).toEqual({ count: 0, target: 'absent' });

			const single = await bench.render({ id: 'selector-single', checkpoint: 'after-run' });
			expect(single.channels.dom.raw).toContain('data-clicked="share"');

			const ambiguous = await renderError(bench, 'selector-ambiguous');
			expect(ambiguous.code).toBe('TARGET_AMBIGUOUS');
			expect(ambiguous.message).toContain('2 elements');
			expect(ambiguous.suggestion).toContain('2');
			expect(ambiguous.suggestion).toContain('name');
			expect(ambiguous.suggestion).toContain('review page');
			expect(ambiguous.details).toEqual({ count: 2, target: 'action' });
		});

		it('resolves zero, one, and multiple matches for { role, name? }', async () => {
			const notFound = await renderError(bench, 'role-missing');
			expect(notFound.code).toBe('TARGET_NOT_FOUND');
			expect(notFound.message).toContain("Target 'print'");
			expect(notFound.suggestion).toContain('review page');
			expect(notFound.suggestion).toContain('role');
			expect(notFound.details).toEqual({ count: 0, target: 'print' });

			const single = await bench.render({ id: 'role-single', checkpoint: 'after-run' });
			expect(single.channels.dom.raw).toContain('data-clicked="share"');

			const ambiguous = await renderError(bench, 'role-ambiguous');
			expect(ambiguous.code).toBe('TARGET_AMBIGUOUS');
			expect(ambiguous.message).toContain('2 elements');
			expect(ambiguous.suggestion).toContain('2');
			expect(ambiguous.suggestion).toContain('name');
			expect(ambiguous.suggestion).toContain('review page');
			expect(ambiguous.details).toEqual({ count: 2, target: 'anyButton' });
		});
	}
);
