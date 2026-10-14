import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildFixture } from './build.mjs';
import { assertPinnedConvexFixtureDependency } from './cli-preflight.mjs';
import { withDeadline } from './lib.mjs';
import { checkConvexModulePaths } from './module-paths.mjs';
import { startFixtureServer } from './server.mjs';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const authDir = join(fixtureDir, '..', '..');

function run(command, args, cwd = authDir, stdio = 'inherit') {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio, shell: false });
		let killTimer;
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
			killTimer.unref();
			reject(new Error(`${command} exceeded the 60 second local-check deadline`));
		}, 60_000);
		child.once('error', (error) => {
			clearTimeout(timer);
			clearTimeout(killTimer);
			reject(error);
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			clearTimeout(killTimer);
			code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`));
		});
	});
}

async function verifyConvexDependencyPreflight(preflightDir) {
	await mkdir(preflightDir, { recursive: true });
	const fixturePackage = assertPinnedConvexFixtureDependency(
		JSON.parse(await readFile(join(fixtureDir, 'package.json'), 'utf8'))
	);
	await writeFile(join(preflightDir, 'package.json'), JSON.stringify(fixturePackage));
	await symlink(
		join(authDir, 'node_modules'),
		join(preflightDir, 'node_modules'),
		process.platform === 'win32' ? 'junction' : 'dir'
	);

	const environment = { ...process.env };
	for (const key of Object.keys(environment)) {
		if (key.startsWith('CONVEX_')) delete environment[key];
	}
	// Keep the pinned CLI preflight isolated from both this fixture's ignored
	// .env.local and the operator's global Convex configuration.
	environment.HOME = preflightDir;
	environment.USERPROFILE = preflightDir;
	environment.XDG_CONFIG_HOME = preflightDir;
	const result = spawnSync(
		join(authDir, 'node_modules', '.bin', 'convex'),
		['codegen', '--dry-run', '--typecheck', 'disable'],
		{
			cwd: preflightDir,
			env: environment,
			encoding: 'utf8',
			timeout: 60_000,
		}
	);
	if (result.error) throw result.error;
	if (
		result.status !== 1 ||
		!result.stderr.includes('No CONVEX_DEPLOYMENT set') ||
		result.stderr.includes('add `convex` to your package.json')
	) {
		throw new Error('Convex CLI did not pass its package dependency preflight');
	}
}

const outputDir = await mkdtemp(join(tmpdir(), 'afd-convex-check-'));
try {
	await run(process.execPath, ['--test', join(fixtureDir, 'lib.test.mjs')]);
	await run(process.execPath, ['--test', join(fixtureDir, 'cli-preflight.test.mjs')]);
	await run(process.execPath, ['--test', join(fixtureDir, 'module-paths.test.mjs')]);
	const convexEntryPoints = await checkConvexModulePaths(join(fixtureDir, 'convex'));
	console.log(`Checked ${convexEntryPoints.length} Convex backend module paths.`);
	await run(process.execPath, [
		'--experimental-strip-types',
		'--test',
		join(fixtureDir, 'convex', 'identity.test.mjs'),
	]);
	await run(process.execPath, [
		'--experimental-strip-types',
		'--test',
		join(fixtureDir, 'convex', 'principal.test.mjs'),
	]);
	await run(process.execPath, [
		'--experimental-strip-types',
		'--test',
		join(fixtureDir, 'convex', 'oauth_user.test.mjs'),
	]);
	const cliPreflightDir = join(outputDir, 'convex-cli-preflight');
	await verifyConvexDependencyPreflight(cliPreflightDir);
	await run(join(authDir, 'node_modules', '.bin', 'convex'), ['--help'], cliPreflightDir, 'ignore');
	await run(join(authDir, 'node_modules', '.bin', 'auth'), ['--help'], cliPreflightDir, 'ignore');
	await run(join(authDir, 'node_modules', '.bin', 'tsc'), [
		'-p',
		join(fixtureDir, 'tsconfig.json'),
		'--pretty',
		'false',
	]);
	await buildFixture(outputDir);
	const server = await startFixtureServer({
		directory: outputDir,
		deploymentUrl: new URL('https://127.0.0.1:1'),
	});
	let browser;
	try {
		browser = await chromium.launch({ headless: true, timeout: 15_000 });
		const page = await browser.newPage();
		await page.goto(server.origin, { waitUntil: 'domcontentloaded', timeout: 15_000 });
		await page.waitForFunction(
			() => window.afdConvex?.snapshot().status === 'unauthenticated',
			undefined,
			{ timeout: 15_000 }
		);
	} finally {
		if (browser) await withDeadline(() => browser.close(), 15_000, 'local-browser-close');
		await withDeadline(() => server.close(), 15_000, 'local-server-close');
	}
	console.log('Convex hosted fixture local checks passed (hosted provider NOT RUN).');
} finally {
	await rm(outputDir, { recursive: true, force: true });
}
