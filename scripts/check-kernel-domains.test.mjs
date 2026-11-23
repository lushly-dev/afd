import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkKernelDomains, DOMAIN_RULES, KERNEL_SRC } from './check-kernel-domains.mjs';

const root = join(import.meta.dirname, '..');

function withTempTree(files, run) {
	const dir = mkdtempSync(join(tmpdir(), 'kernel-domains-'));
	try {
		for (const [rel, content] of Object.entries(files)) {
			const full = join(dir, KERNEL_SRC, rel);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, content, 'utf8');
		}
		return run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('#1778: the real loam-kernel source tree satisfies every domain boundary rule', () => {
	const { errors, checked } = checkKernelDomains(root);
	assert.deepEqual(errors, []);
	assert.ok(checked >= 100, `expected >= 100 kernel source files, got ${checked}`);
});

test('#1778: a domain importing from late/ is refused', () => {
	const { errors } = withTempTree(
		{
			'late/index.ts': 'export const x = 1;\n',
			'settings/settings.ts': "import { x } from '../late/index.js';\nexport const y = x;\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /domain "settings" may not import "late" at runtime/);
});

test('#1778: cross-domain runtime import into a type-only neighbor is refused while import type passes', () => {
	const bad = withTempTree(
		{
			'documents/editor-state.ts': 'export const empty = 1; export type State = number;\n',
			'identity/session-settle.ts':
				"import { empty } from '../documents/editor-state.js';\nexport const x = empty;\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(bad.errors.length, 1);
	assert.match(bad.errors[0], /only `import type` is allowed/);

	const ok = withTempTree(
		{
			'documents/editor-state.ts': 'export const empty = 1; export type State = number;\n',
			'identity/session-settle.ts':
				"import type { State } from '../documents/editor-state.js';\nexport type S = State;\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.deepEqual(ok.errors, []);
});

test('#1778: stage-A core statically importing a stage-B domain is refused while dynamic import passes', () => {
	const bad = withTempTree(
		{
			'settings/settings.ts': 'export const s = 1;\n',
			'kernel.ts': "import { s } from './settings/settings.js';\nexport const k = s;\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(bad.errors.length, 1);
	assert.match(bad.errors[0], /stage-A core may not statically import stage-B domain "settings"/);

	const ok = withTempTree(
		{
			'late/index.ts': 'export const s = 1;\n',
			'kernel.ts': "export const load = () => import('./late/index.js');\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.deepEqual(ok.errors, []);
});

test('#1778: unknown domain folder under kernel/src is refused', () => {
	const { errors } = withTempTree(
		{
			'misc/stuff.ts': 'export const z = 1;\n',
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /unknown kernel domain "misc"/);
});

test('#1778: DOMAIN_RULES covers every domain named in the issue', () => {
	for (const domain of ['identity', 'settings', 'documents', 'overlays', 'apps']) {
		assert.ok(Object.hasOwn(DOMAIN_RULES, domain), domain);
	}
});

test('#1778: package self-imports, static apps re-exports, and inline type imports are refused', () => {
	// 1. Package self-import bypasses relative domain rules.
	const selfImport = withTempTree(
		{
			'settings/settings.ts':
				"import { x } from '@lushly-dev/loam-kernel/copilot';\nexport { x };\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(selfImport.errors.length, 1);
	assert.match(selfImport.errors[0], /package self-import/);

	// 2. Stage-A core statically re-exporting apps/ is refused.
	const appsReexport = withTempTree(
		{
			'apps/index.ts': 'export const a = 1;\n',
			'kernel.ts': "export { a } from './apps/index.js';\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(appsReexport.errors.length, 1);
	assert.match(
		appsReexport.errors[0],
		/stage-A core may not statically import stage-B domain "apps"/
	);

	// 3. Inline `import { type X }` emits a runtime import under verbatimModuleSyntax and is refused.
	const inlineType = withTempTree(
		{
			'settings/settings.ts': 'export type Settings = { ok: boolean };\n',
			'kernel.ts':
				"import { type Settings } from './settings/settings.js';\nexport type S = Settings;\n",
		},
		(dir) => checkKernelDomains(dir)
	);
	assert.equal(inlineType.errors.length, 1);
	assert.match(
		inlineType.errors[0],
		/stage-A core may not statically import stage-B domain "settings"/
	);
});
