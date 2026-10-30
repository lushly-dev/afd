#!/usr/bin/env node
/**
 * Generate the dashboard's report fixtures by running the real Health CLI
 * (`python -m lushly_health audit`, through uv and endpoints/health's lock) against
 * small plain repositories created in a temporary directory.
 *
 * The fixture repositories have no AFD, Botcore, Health or FAST-AF dependency. Each
 * report's caller-local `targets[].path` is replaced by `<fixture>/<id>` so committed
 * fixtures carry no machine path, and `generated_at` is pinned to FIXTURE_TIME so they
 * are reproducible; nothing else is edited. `--check` regenerates into
 * memory and fails when a committed fixture differs.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const healthProject = resolve(packageRoot, '../health');
const output = join(packageRoot, 'fixtures/reports');
const check = process.argv.includes('--check');
const FIXTURE_TIME = '2026-01-01T00:00:00Z';

const GITATTRIBUTES = '* text=auto eol=lf\n';
const ruffProject = (name) =>
	`[project]\nname = "${name}"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 100\n`;
const LEFTHOOK = 'pre-commit:\n  commands: {}\npre-push:\n  commands: {}\n';

/** Plain repositories: file name -> contents. None declares a platform dependency. */
const repositories = {
	'web-app': {
		'.gitattributes': GITATTRIBUTES,
		'.nvmrc': 'lts/*\n',
		'package.json': '{ "name": "web-app", "private": true }\n',
	},
	// Truncated on purpose: the Node check raises and Health reports `error`.
	'broken-config': { 'package.json': '{ "name": "broken-config",\n' },
	'api-service': { '.gitattributes': GITATTRIBUTES, 'pyproject.toml': ruffProject('api-service') },
	'tidy-lib': {
		'.gitattributes': GITATTRIBUTES,
		'lefthook.yml': LEFTHOOK,
		'pyproject.toml': ruffProject('tidy-lib'),
	},
};

/** Each fixture: targets [id, language] and a caller-owned policy (Health's own format). */
const fixtures = {
	'mixed-status': {
		targets: [
			['web-app', 'typescript'],
			['broken-config', 'typescript'],
			['api-service', 'python'],
		],
		policy: {
			checks: [
				'gitattributes_lf',
				'lefthook_configured',
				'node_version_alignment',
				'commitlint_configured',
				'linter_strict',
				'dependabot_configured',
				'last_commit',
			],
			disabled: ['dependabot_configured'],
			severity: { commitlint_configured: 'advisory', linter_strict: 'advisory' },
		},
	},
	'all-passed': {
		targets: [['tidy-lib', 'python']],
		policy: { checks: ['gitattributes_lf', 'lefthook_configured', 'linter_strict'] },
	},
	// A failing required check disabled by policy no longer prevents a pass.
	'passed-with-disabled': {
		targets: [['tidy-lib', 'python']],
		policy: {
			checks: ['gitattributes_lf', 'lefthook_configured', 'dependabot_configured'],
			disabled: ['dependabot_configured'],
		},
	},
	'advisory-only': {
		targets: [['tidy-lib', 'python']],
		policy: {
			checks: ['gitattributes_lf', 'linter_strict'],
			severity: { gitattributes_lf: 'advisory', linter_strict: 'advisory' },
		},
	},
	'empty-plan': {
		targets: [['tidy-lib', 'python']],
		policy: { checks: [] },
	},
};

function audit(workspace, name, fixture) {
	const targets = fixture.targets.map(([id, language]) => ({
		id,
		path: `repos/${id}`,
		language,
	}));
	const targetsFile = join(workspace, `${name}.targets.json`);
	const policyFile = join(workspace, `${name}.policy.json`);
	writeFileSync(targetsFile, JSON.stringify({ schema_version: '1.0', targets }));
	writeFileSync(policyFile, JSON.stringify({ schema_version: '1.0', ...fixture.policy }));
	// Hook-inherited Git routing or an active virtual environment must not leak in.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'VIRTUAL_ENV')
	);
	const result = spawnSync(
		'uv',
		[
			'run',
			'--frozen',
			'--quiet',
			'--project',
			healthProject,
			'python',
			'-m',
			'lushly_health',
			'audit',
			'--targets',
			targetsFile,
			'--policy',
			policyFile,
		],
		{ cwd: workspace, env, encoding: 'utf8' }
	);
	if (result.error) throw new Error(`Cannot run uv: ${result.error.message}`);
	if (result.status !== 0)
		throw new Error(`Health audit for ${name} exited ${result.status}:\n${result.stderr}`);
	const report = JSON.parse(result.stdout);
	for (const target of report.targets) target.path = `<fixture>/${target.id}`;
	report.generated_at = FIXTURE_TIME;
	const text = `${JSON.stringify(report, null, '\t')}\n`;
	for (const root of new Set([workspace, realpathSync(workspace)]))
		if (text.includes(root)) throw new Error(`${name}: a machine path survived sanitizing`);
	return text;
}

const workspace = mkdtempSync(join(tmpdir(), 'health-dashboard-fixtures-'));
let stale = 0;
try {
	for (const [id, files] of Object.entries(repositories)) {
		mkdirSync(join(workspace, 'repos', id), { recursive: true });
		for (const [file, contents] of Object.entries(files))
			writeFileSync(join(workspace, 'repos', id, file), contents);
	}
	for (const [name, fixture] of Object.entries(fixtures)) {
		const destination = join(output, `${name}.report.json`);
		const text = audit(workspace, name, fixture);
		if (!check) {
			writeFileSync(destination, text);
			console.log(`wrote fixtures/reports/${name}.report.json`);
			continue;
		}
		let committed = '';
		try {
			committed = readFileSync(destination, 'utf8');
		} catch {}
		if (committed === text)
			console.log(`✓ fixtures/reports/${name}.report.json matches the Health CLI output`);
		else {
			stale++;
			console.error(`✘ fixtures/reports/${name}.report.json differs from the Health CLI output`);
		}
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
if (stale) {
	console.error('Run `pnpm -F @lushly-dev/health-dashboard fixtures` and review the diff.');
	process.exitCode = 1;
}
