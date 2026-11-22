import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	checkChangedVectors,
	checkGeneratorDrift,
	checkVectorManifest,
	hasBehaviourChangeFragment,
	VECTOR_MANIFEST,
} from './check-vector-drift.mjs';

function makeFixture(setup) {
	const root = mkdtempSync(join(tmpdir(), 'afd-vector-drift-'));
	try {
		mkdirSync(join(root, 'spec', 'vectors'), { recursive: true });
		mkdirSync(join(root, '.changeset'), { recursive: true });
		setup(root);
		return root;
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}

test('checkVectorManifest fails on an unclassified vector JSON file', () => {
	const root = makeFixture((dir) => {
		writeFileSync(join(dir, 'spec/vectors/known.json'), '{}\n');
		writeFileSync(join(dir, 'spec/vectors/mystery.json'), '{}\n');
	});
	try {
		const problems = checkVectorManifest(root, { 'known.json': { kind: 'authored' } });
		assert.equal(problems.length, 1);
		assert.match(problems[0], /mystery\.json is not classified/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('checkVectorManifest fails on an unclaimed generator script', () => {
	const root = makeFixture((dir) => {
		writeFileSync(join(dir, 'spec/vectors/known.json'), '{}\n');
		writeFileSync(join(dir, 'spec/vectors/generate-rogue.mjs'), 'export {};\n');
	});
	try {
		const problems = checkVectorManifest(root, { 'known.json': { kind: 'authored' } });
		assert.equal(problems.length, 1);
		assert.match(problems[0], /generate-rogue\.mjs is not claimed/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('checkChangedVectors fails when a generated vector changes without a behaviour-change changeset', () => {
	const root = makeFixture((dir) => {
		writeFileSync(
			join(dir, '.changeset/normal-note.md'),
			'---\n"afd-spec": patch\n---\n\nRoutine documentation update.\n'
		);
	});
	try {
		const problems = checkChangedVectors({
			root,
			changedFiles: ['spec/vectors/validation.json', '.changeset/normal-note.md'],
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /spec\/vectors\/validation\.json/);
		assert.match(problems[0], /Behaviour change:/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('checkChangedVectors passes when a behaviour-change changeset fragment is present', () => {
	const root = makeFixture((dir) => {
		writeFileSync(
			join(dir, '.changeset/vector-bump.md'),
			'---\n"afd-spec": patch\n---\n\nBehaviour change: updated validation vectors for new schema rule.\n'
		);
	});
	try {
		assert.equal(hasBehaviourChangeFragment(root, ['.changeset/vector-bump.md']), true);
		const problems = checkChangedVectors({
			root,
			changedFiles: ['spec/vectors/validation.json', '.changeset/vector-bump.md'],
		});
		assert.deepEqual(problems, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('checkChangedVectors accepts American spelling (Behavior change:) and ignores authored vectors', () => {
	const root = makeFixture((dir) => {
		writeFileSync(
			join(dir, '.changeset/us-spelling.md'),
			'---\n"@lushly-dev/afd-server": minor\n---\n\nBehavior change: adjusted output schema.\n'
		);
	});
	try {
		assert.deepEqual(
			checkChangedVectors({
				root,
				changedFiles: ['spec/vectors/output-schema.json', '.changeset/us-spelling.md'],
			}),
			[]
		);
		// Specification-authored files do not require a regenerated-vector behaviour-change marker.
		assert.deepEqual(
			checkChangedVectors({
				root,
				changedFiles: ['spec/vectors/dispatch.json', 'spec/vectors/execution-controls.json'],
			}),
			[]
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('checkGeneratorDrift fails when a generator output differs from the committed vector file', () => {
	const root = makeFixture((dir) => {
		mkdirSync(join(dir, 'packages/core/dist'), { recursive: true });
		writeFileSync(join(dir, 'packages/core/dist/index.js'), '');
		writeFileSync(join(dir, 'spec/vectors/sample.json'), '{"cases":[1]}\n');
		writeFileSync(join(dir, 'spec/vectors/generate-sample.mjs'), '');
	});
	try {
		const manifest = {
			'sample.json': {
				kind: 'reference-generated',
				generator: 'generate-sample.mjs',
				needs: ['packages/core/dist/index.js'],
			},
		};
		const drift = checkGeneratorDrift({
			root,
			manifest,
			requireGenerators: true,
			execNode: () => '{"cases":[2]}\n',
		});
		assert.equal(drift.problems.length, 1);
		assert.match(drift.problems[0], /spec\/vectors\/sample\.json differs/);

		const matching = checkGeneratorDrift({
			root,
			manifest,
			requireGenerators: true,
			execNode: () => '{"generatedWith":{"zod":"4.9.0"},"cases": [1]}',
		});
		assert.deepEqual(matching.problems, []);
		assert.deepEqual(matching.checked, ['sample.json']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('VECTOR_MANIFEST classifies every current spec/vectors entry in the repository', () => {
	assert.equal(VECTOR_MANIFEST['execution-controls.json'].kind, 'authored');
	assert.equal(VECTOR_MANIFEST['dispatch.json'].kind, 'authored');
	assert.equal(VECTOR_MANIFEST['validation.json'].kind, 'reference-generated');
	assert.equal(VECTOR_MANIFEST['approval-tokens.json'].kind, 'format-generated');
});
