import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
	spawnTool,
	toolCommand,
	windowsCommandLine,
} from '../../../../scripts/release/exec-tool.mjs';
import { buildFixture } from './build.mjs';
import { assertPinnedConvexFixtureDependency } from './cli-preflight.mjs';
import { createReceipt, launchObserved, withDeadline } from './lib.mjs';
import { checkConvexModulePaths } from './module-paths.mjs';
import { startFixtureServer } from './server.mjs';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const authDir = join(fixtureDir, '..', '..');

function run(command, args, cwd = authDir, stdio = 'inherit') {
	return new Promise((resolve, reject) => {
		// Windows installs node_modules/.bin commands as .cmd shims, which only cmd.exe starts.
		const { file, shell } = toolCommand(command);
		const child = shell
			? spawn(windowsCommandLine(file, args), { cwd, stdio, shell: true })
			: spawn(file, args, { cwd, stdio, shell: false });
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
		join(fixtureDir, 'node_modules'),
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
	const result = spawnTool(
		join(fixtureDir, 'node_modules', '.bin', 'convex'),
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

/** The receipt's runtime comes from this process and the launched browser, and survives JSON. */
async function checkRuntimeReceipt(browser, runtime) {
	const installed = JSON.parse(
		await readFile(new URL('./package.json', import.meta.resolve('playwright')), 'utf8')
	).version;
	const receipt = JSON.parse(
		JSON.stringify(
			createReceipt({
				runId: 'run-local-check',
				revision: 'local',
				deploymentUrl: new URL('https://127.0.0.1:1'),
				assertions: [],
				cleanup: [],
				oauthConfigured: false,
				runtime,
			})
		)
	);
	const expected = {
		executorNode: process.versions.node,
		playwright: installed,
		browser: { name: 'chromium', version: browser.version() },
	};
	if (JSON.stringify(receipt.runtime) !== JSON.stringify(expected)) {
		throw new Error(`Runtime receipt mismatch: ${JSON.stringify(receipt.runtime)}`);
	}
	console.log(`Runtime receipt: ${JSON.stringify(receipt.runtime)}`);
}

const outputDir = await mkdtemp(join(tmpdir(), 'afd-convex-check-'));
try {
	await run(process.execPath, ['--test', join(fixtureDir, 'lib.test.mjs')]);
	await run(process.execPath, ['--test', join(fixtureDir, 'server.test.mjs')]);
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
	await run(
		join(fixtureDir, 'node_modules', '.bin', 'convex'),
		['--help'],
		cliPreflightDir,
		'ignore'
	);
	await run(
		join(fixtureDir, 'node_modules', '.bin', 'auth'),
		['--help'],
		cliPreflightDir,
		'ignore'
	);
	const fixtureTypeScript = join(fixtureDir, 'node_modules', 'typescript', 'bin', 'tsc');
	await run(
		process.execPath,
		[fixtureTypeScript, '-p', join(fixtureDir, 'convex', 'tsconfig.json'), '--pretty', 'false'],
		fixtureDir
	);
	await run(
		process.execPath,
		[fixtureTypeScript, '-p', join(fixtureDir, 'tsconfig.json'), '--pretty', 'false'],
		fixtureDir
	);
	await buildFixture(outputDir);
	const server = await startFixtureServer({
		directory: outputDir,
		deploymentUrl: new URL('https://127.0.0.1:1'),
	});
	let browser;
	try {
		let runtime;
		({ browser, runtime } = await launchObserved(chromium, { headless: true, timeout: 15_000 }));
		await checkRuntimeReceipt(browser, runtime);
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
