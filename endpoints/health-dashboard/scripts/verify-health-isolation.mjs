#!/usr/bin/env node
/**
 * Prove that a headless Health installation cannot pull in this dashboard or any
 * frontend dependency: build Health's wheel (no publication) and check that its
 * unconditional dependency closure is empty and that it ships no dashboard file.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const health = resolve(dirname(fileURLToPath(import.meta.url)), '../../health');
const scratch = mkdtempSync(join(tmpdir(), 'health-wheel-'));
const source = join(scratch, 'source');
const out = join(scratch, 'dist');
const failures = [];
try {
	// Build from a copy: setuptools writes a build/ tree next to the project it builds.
	for (const entry of ['pyproject.toml', 'README.md', 'LICENSE', 'MANIFEST.in', 'src'])
		cpSync(join(health, entry), join(source, entry), { recursive: true });
	const build = spawnSync('uv', ['build', '--wheel', '--quiet', '--out-dir', out, source], {
		encoding: 'utf8',
	});
	if (build.status !== 0) throw new Error(`uv build failed:\n${build.stderr}`);
	const wheel = readdirSync(out).find((name) => name.endsWith('.whl'));
	if (!wheel) throw new Error('No wheel was built');
	// The standard library reads the wheel; nothing is installed.
	const inspect = spawnSync(
		'uv',
		[
			'run',
			'--no-project',
			'--isolated',
			'python',
			'-c',
			`import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
meta = next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))
requires = [l.split(':', 1)[1].strip() for l in z.read(meta).decode().splitlines() if l.startswith('Requires-Dist:')]
print(json.dumps({'files': z.namelist(), 'requires': requires}))`,
			join(out, wheel),
		],
		{ encoding: 'utf8' }
	);
	if (inspect.status !== 0) throw new Error(`Wheel inspection failed:\n${inspect.stderr}`);
	const { files, requires } = JSON.parse(inspect.stdout);
	const unconditional = requires.filter((requirement) => !/;\s*extra\s*==/.test(requirement));
	if (unconditional.length)
		failures.push(`unconditional requirements: ${unconditional.join(', ')}`);
	const frontend = requires.filter((requirement) =>
		/dashboard|fast|violet|node|npm/i.test(requirement)
	);
	if (frontend.length) failures.push(`frontend requirements: ${frontend.join(', ')}`);
	const shipped = files.filter((file) => /dashboard|\.(?:html|js|mjs|css|ts)$/i.test(file));
	if (shipped.length) failures.push(`frontend files in the wheel: ${shipped.join(', ')}`);
	console.log(
		`${wheel}: ${files.length} files; extras-only requirements: ${requires.join('; ') || 'none'}`
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
if (failures.length) {
	for (const failure of failures) console.error(`✘ ${failure}`);
	process.exitCode = 1;
} else console.log('✓ Headless Health has no unconditional dependency and ships no dashboard file');
