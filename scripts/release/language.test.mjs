import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { planRelease } from './control.mjs';

for (const [format, registry, file] of [
	['python', 'pypi', 'pyproject.toml'],
	['rust', 'crates', 'Cargo.toml'],
	['cpp', 'source', 'CMakeLists.txt'],
]) {
	test(`${format}: all four independently selected batch examples preserve prerequisite and coordinated intent rules`, () => {
		const root = mkdtempSync(join(tmpdir(), `afd-${format}-release-`));
		const units = ['a', 'b'].map((id) => ({
			id,
			family: id,
			protocol: 'category-json-v1',
			state: id === 'b' ? 'held' : 'admitted',
			authority: 'fixture',
			sourceRevision: 'fixture',
			routes: [`${format}-tag`],
			gates: ['fixture'],
			distributions: [{ name: id, registry, format, manifest: `foundations/${id}/${file}` }],
		}));
		const inventory = {
			schemaVersion: 1,
			units,
			storages: [{ path: 'release-intent/native', protocol: 'category-json-v1' }],
		};
		function write(file, text) {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), text);
		}
		for (const id of ['a', 'b']) {
			const text =
				format === 'cpp'
					? `project(${id} VERSION 1.0.0 LANGUAGES CXX)\n`
					: `[${format === 'python' ? 'project' : 'package'}]\nname="${id}"\nversion="1.0.0"\n`;
			write(`foundations/${id}/${file}`, text);
			write(
				`release-intent/native/${id}.json`,
				JSON.stringify({
					protocol: 'category-json-v1',
					units: [id],
					category: 'fixed',
					summary: `Fix ${id}`,
				})
			);
		}
		const plan = (registryEvidence = []) =>
			planRelease({ root, inventory, selectedUnits: ['a'], registryEvidence });
		assert.equal(plan().distributions.length, 1);
		units[0].prerequisites = [{ registry, name: 'b', range: '^1.0.0' }];
		assert.throws(() => plan(), /Unsatisfied prerequisite/);
		assert.equal(plan([{ registry, name: 'b', versions: ['1.2.0'] }]).distributions.length, 1);
		write(
			'release-intent/native/a.json',
			JSON.stringify({
				protocol: 'category-json-v1',
				units: ['a', 'b'],
				category: 'fixed',
				summary: 'Coordinated change',
			})
		);
		assert.throws(
			() => plan([{ registry, name: 'b', versions: ['1.2.0'] }]),
			/Incomplete coordinated/
		);
	});
}

for (const format of ['python', 'rust']) {
	test(`${format}: actual native manifest requirements constrain held aliases before planning`, () => {
		const root = mkdtempSync(join(tmpdir(), `afd-${format}-manifest-`));
		const registry = format === 'python' ? 'pypi' : 'crates';
		const file = format === 'python' ? 'pyproject.toml' : 'Cargo.toml';
		const name = format === 'python' ? 'Held_Package.Name' : 'held-package';
		const units = ['caller', 'dependency'].map((id) => ({
			id,
			family: id,
			protocol: 'language-tag-v1',
			state: id === 'caller' ? 'admitted' : 'held',
			authority: 'fixture',
			sourceRevision: 'fixture',
			routes: [`${format}-tag`],
			gates: ['fixture'],
			distributions: [
				{
					name: id === 'caller' ? 'caller' : name,
					registry,
					format,
					manifest: `foundations/${id}/${file}`,
				},
			],
		}));
		const inventory = { schemaVersion: 1, units, storages: [] };
		const write = (id, text) => {
			const path = join(root, `foundations/${id}/${file}`);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		};
		write(
			'caller',
			format === 'python'
				? '[ "project" ]\nname="caller"\nversion="1.0.0"\ndependencies=["held-package_name>=1,<2"]\n'
				: '[package]\nname="caller"\nversion="1.0.0"\n[dependencies]\nalias={package="held-package",version="1"}\n'
		);
		write(
			'dependency',
			`[${format === 'python' ? 'project' : 'package'}]\nname="${name}"\nversion="2.0.0"\n`
		);
		const plan = (registryEvidence = []) =>
			planRelease({ root, inventory, selectedUnits: ['caller'], registryEvidence });
		assert.throws(() => plan(), /Unsatisfied prerequisite/);
		const evidence = [
			{ registry, name: format === 'python' ? 'HELD.package-name' : name, versions: ['1.4.0'] },
		];
		assert.equal(plan(evidence).distributions.length, 1);
		assert.throws(
			() => plan([{ registry, name, versions: ['2.0.0'] }]),
			/Unsatisfied prerequisite/
		);
		assert.throws(
			() => planRelease({ root, inventory, selectedUnits: ['caller', 'dependency'] }),
			/not admitted/
		);
	});
}
