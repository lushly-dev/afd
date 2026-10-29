import assert from 'node:assert/strict';
import test from 'node:test';
import {
	cargoRequirements,
	npmRequirements,
	pythonRequirements,
} from './manifest-requirements.mjs';

test('Python prerequisites include extras, normalize identities and preserve exact compatible ranges', () => {
	const requirements = pythonRequirements({
		name: 'A',
		dependencies: [
			'A[cli]',
			'Other_Name~=1.4.5',
			'exact==1.2',
			'external>=1,<2; python_version > "3.10"',
		],
		'optional-dependencies': { server: ['tool-name==2.*'] },
	});
	assert.deepEqual(requirements, [
		{ registry: 'pypi', name: 'a', range: '*' },
		{ registry: 'pypi', name: 'other-name', range: '>=1.4.5 <1.5.0' },
		{ registry: 'pypi', name: 'exact', range: '1.2.0' },
		{ registry: 'pypi', name: 'external', range: '>=1.0.0 <2.0.0' },
		{ registry: 'pypi', name: 'tool-name', range: '2.x' },
	]);
});
test('Cargo dependencies preserve caret-default semantics, aliases, targets and missing path versions', () => {
	const requirements = cargoRequirements({
		dependencies: {
			normal: '1.2.3',
			alias: { package: 'real-name', version: '>=1, <2' },
			local: { path: '../local' },
		},
		'build-dependencies': { builder: '0.2' },
		target: { 'cfg(unix)': { dependencies: { platform: { version: '=3.0.0', optional: true } } } },
	});
	assert.deepEqual(requirements, [
		{ registry: 'crates', name: 'normal', range: '^1.2.3' },
		{ registry: 'crates', name: 'real-name', range: '>=1  <2' },
		{ registry: 'crates', name: 'local', range: null },
		{ registry: 'crates', name: 'builder', range: '^0.2' },
		{ registry: 'crates', name: 'platform', range: '=3.0.0' },
	]);
});

test('npm aliases retain actual prerequisite identities and every dependency field', () => {
	assert.deepEqual(
		npmRequirements({
			dependencies: { alias: 'npm:@scope/held@^1.0.0' },
			peerDependencies: { alias: 'npm:@scope/held@^2.0.0' },
			optionalDependencies: { local: 'workspace:@scope/helper@^' },
		}),
		[
			{ registry: 'npm', name: '@scope/held', range: '^1.0.0' },
			{ registry: 'npm', name: '@scope/helper', range: 'workspace:^' },
			{ registry: 'npm', name: '@scope/held', range: '^2.0.0' },
		]
	);
});

test('Python comparison bounds use exact padded versions instead of npm partial-version ranges', () => {
	assert.deepEqual(
		pythonRequirements({ name: 'caller', dependencies: ['upper<=1.2', 'lower>1', 'wild==1.2.*'] }),
		[
			{ registry: 'pypi', name: 'upper', range: '<=1.2.0' },
			{ registry: 'pypi', name: 'lower', range: '>1.0.0' },
			{ registry: 'pypi', name: 'wild', range: '1.2.x' },
		]
	);
});
