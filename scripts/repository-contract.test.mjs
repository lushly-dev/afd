import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function ensureBuilt(packageDirectory, requiredFiles) {
	const distDirectory = join(repoRoot, packageDirectory, 'dist');
	if (requiredFiles.every((file) => existsSync(join(distDirectory, file)))) return;

	execFileSync('pnpm', ['--dir', packageDirectory, 'build'], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
}

function copyBuiltPackage(packageDirectory, consumerRoot) {
	const source = join(repoRoot, packageDirectory);
	const packageManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
	const destination = join(consumerRoot, 'node_modules', ...packageManifest.name.split('/'));
	mkdirSync(destination, { recursive: true });
	cpSync(join(source, 'package.json'), join(destination, 'package.json'));
	cpSync(join(source, 'dist'), join(destination, 'dist'), { recursive: true });
}

function linkPeer(consumerRoot, packageName, source) {
	const destination = join(consumerRoot, 'node_modules', ...packageName.split('/'));
	mkdirSync(dirname(destination), { recursive: true });
	symlinkSync(source, destination, 'dir');
}

function runConsumer(consumerRoot, source) {
	const entrypoint = join(consumerRoot, 'consumer.mjs');
	writeFileSync(entrypoint, source);
	execFileSync(process.execPath, [entrypoint], { cwd: consumerRoot, stdio: 'pipe' });
}

test('release documentation and workflow agree with root scripts', () => {
	const manifest = JSON.parse(read('package.json'));
	const agents = read('AGENTS.md');
	const release = read('.github/workflows/release.yml');

	assert.equal(typeof manifest.scripts.changeset, 'string');
	assert.equal(typeof manifest.scripts['version-packages'], 'string');
	assert.equal(manifest.scripts['test:coverage'], 'pnpm -r --no-bail test --coverage');
	assert.doesNotMatch(agents, /pnpm release patch|scripts\/release\.mjs|push origin main --tags/);
	assert.match(agents, /pnpm changeset/);

	const qualityGate = release.indexOf('run: pnpm check');
	const publishAction = release.search(/uses: changesets\/action@[0-9a-f]{40} # v1\./);
	assert.ok(qualityGate >= 0, 'release workflow must run pnpm check');
	assert.ok(publishAction > qualityGate, 'quality gate must finish before Changesets can publish');
});

test('workflow actions are pinned to full commit SHAs', () => {
	const workflowDirectory = '.github/workflows';
	for (const entry of readdirSync(new URL(`../${workflowDirectory}/`, import.meta.url))) {
		if (!/\.ya?ml$/.test(entry)) continue;
		for (const line of read(`${workflowDirectory}/${entry}`).split('\n')) {
			const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
			if (!match || match[1].startsWith('./')) continue;
			assert.match(
				`${match[1]}${match[2]}`,
				/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
				`${entry}: pin "${match[1]}" to a commit SHA with a "# vX.Y.Z" comment`
			);
		}
	}
});

function publishedPackageDirectories() {
	return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `packages/${entry.name}`)
		.filter((directory) => existsSync(join(repoRoot, directory, 'package.json')))
		.filter((directory) => JSON.parse(read(`${directory}/package.json`)).private !== true);
}

function testFiles(directory, root = directory) {
	const found = [];
	for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
			continue;
		}
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) found.push(...testFiles(path, root));
		else if (/\.test\.tsx?$/.test(entry.name)) found.push(path.slice(root.length + 1));
	}
	return found;
}

test('every published package type-checks its tests', () => {
	const packages = publishedPackageDirectories();
	assert.ok(packages.includes('packages/core'), 'expected to find the published packages');

	for (const directory of packages) {
		const manifest = JSON.parse(read(`${directory}/package.json`));
		assert.equal(
			manifest.scripts?.typecheck,
			'tsc -p tsconfig.typecheck.json',
			`${directory} needs a test-inclusive typecheck script`
		);

		const config = JSON.parse(read(`${directory}/tsconfig.typecheck.json`));
		assert.equal(config.extends, './tsconfig.json', `${directory}/tsconfig.typecheck.json`);
		assert.equal(config.compilerOptions?.noEmit, true, `${directory}/tsconfig.typecheck.json`);
		for (const pattern of config.exclude ?? []) {
			assert.doesNotMatch(pattern, /test/, `${directory}/tsconfig.typecheck.json excludes tests`);
		}

		const roots = (config.include ?? [])
			.filter((pattern) => pattern.endsWith('/**/*'))
			.map((pattern) => pattern.slice(0, -'**/*'.length));
		for (const file of testFiles(directory)) {
			assert.ok(
				roots.some((root) => file.startsWith(root)),
				`${directory}/${file} is outside tsconfig.typecheck.json's include`
			);
		}
	}
});

test('every published package enforces coverage thresholds', () => {
	for (const directory of publishedPackageDirectories()) {
		const configPath = `${directory}/vitest.config.ts`;
		assert.ok(existsSync(join(repoRoot, configPath)), `${directory} needs a vitest.config.ts`);
		const config = read(configPath);

		assert.doesNotMatch(config, /globals:\s*true/, `${configPath} must use explicit imports`);
		assert.match(config, /include:\s*\[\s*'src\/\*\*\/\*\.ts'\s*\]/, `${configPath} coverage`);
		const thresholds = config.match(/thresholds:\s*\{([^}]*)\}/)?.[1];
		assert.ok(thresholds, `${configPath} needs coverage thresholds`);
		for (const metric of ['statements', 'branches', 'functions', 'lines']) {
			assert.match(thresholds, new RegExp(`${metric}:\\s*[1-9]\\d*`), `${configPath} ${metric}`);
		}
	}
});

test('public TypeScript example commands explicitly opt in to MCP', () => {
	const commandDirectories = [
		'packages/examples/todo/backends/typescript/src/commands',
		'packages/examples/todo-directclient/backend/src/commands',
		'packages/examples/chat/src/commands',
	];

	for (const directory of commandDirectories) {
		for (const entry of readdirSync(new URL(`../${directory}/`, import.meta.url))) {
			if (!entry.endsWith('.ts') || entry === 'index.ts' || entry.endsWith('.test.ts')) continue;
			const source = read(`${directory}/${entry}`);
			if (!source.includes('defineCommand')) continue;
			assert.match(source, /expose:\s*\{\s*mcp:\s*true\s*\}/, `${directory}/${entry}`);
		}
	}
});

test('Todo scripts and copied command examples reference real entry points', () => {
	const manifest = JSON.parse(read('packages/examples/todo/package.json'));
	const readme = read('packages/examples/todo/README.md');
	const pythonReadme = read('packages/examples/todo/backends/python/README.md');

	assert.match(
		manifest.scripts['test:conformance:ts'],
		/pnpm --dir backends\/typescript build && tsx dx\/run-conformance\.ts --backend ts/
	);
	assert.match(manifest.scripts['test:conformance:py'], /--backend py/);
	assert.match(manifest.scripts['dev:py'], /uv run --project backends\/python todo-server/);
	assert.equal(manifest.scripts['dev:desktop'], undefined);
	assert.equal(manifest.scripts['build:desktop'], undefined);
	assert.doesNotMatch(readme, /dx\/run-conformance\.ts (ts|py)|afd batch 'todo-/);
	assert.doesNotMatch(pythonReadme, /requirements\.txt|python server\.py/);
});

test('auth built package keeps the core entrypoint free of optional peers', () => {
	const authManifest = JSON.parse(read('packages/auth/package.json'));
	for (const peer of Object.keys(authManifest.peerDependencies)) {
		assert.equal(
			authManifest.peerDependenciesMeta?.[peer]?.optional,
			true,
			`${peer} must remain an optional peer dependency`
		);
	}

	ensureBuilt('packages/core', ['index.js']);
	ensureBuilt('packages/auth', ['index.js', 'react.js', 'commands.js']);

	const consumerRoot = mkdtempSync(join(tmpdir(), 'afd-auth-core-consumer-'));
	try {
		copyBuiltPackage('packages/core', consumerRoot);
		copyBuiltPackage('packages/auth', consumerRoot);
		runConsumer(
			consumerRoot,
			`import assert from 'node:assert/strict';

const auth = await import('@lushly-dev/afd-auth');
assert.equal(typeof auth.MockAuthAdapter, 'function');
assert.equal(typeof auth.BetterAuthAdapter, 'function');
assert.equal(typeof auth.createAuthMiddleware, 'function');
assert.equal(typeof auth.SessionSync, 'function');
assert.equal(auth.createAuthCommands, undefined);
assert.equal(auth.useConvexAuthAdapter, undefined);
`
		);
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
});

test('auth integration subpaths resolve when their peers are installed', () => {
	ensureBuilt('packages/core', ['index.js']);
	ensureBuilt('packages/server', ['index.js']);
	ensureBuilt('packages/auth', ['index.js', 'react.js', 'commands.js']);

	const consumerRoot = mkdtempSync(join(tmpdir(), 'afd-auth-integration-consumer-'));
	try {
		copyBuiltPackage('packages/core', consumerRoot);
		copyBuiltPackage('packages/auth', consumerRoot);
		linkPeer(consumerRoot, '@lushly-dev/afd-server', join(repoRoot, 'packages/server'));
		linkPeer(consumerRoot, 'react', join(repoRoot, 'packages/auth/node_modules/react'));
		linkPeer(consumerRoot, 'zod', join(repoRoot, 'packages/auth/node_modules/zod'));
		runConsumer(
			consumerRoot,
			`import assert from 'node:assert/strict';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';

const react = await import('@lushly-dev/afd-auth/react');
assert.equal(typeof react.createAuthHooks, 'function');
assert.equal(typeof react.useConvexAuthAdapter, 'function');
const hooks = react.createAuthHooks(new MockAuthAdapter());
assert.equal(typeof hooks.useSession, 'function');

const commands = await import('@lushly-dev/afd-auth/commands');
assert.equal(typeof commands.createAuthCommands, 'function');
assert.deepEqual(
	commands.createAuthCommands(new MockAuthAdapter()).map((command) => command.name),
	['auth-sign-in', 'auth-sign-out', 'auth-session-get'],
);
`
		);
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
});
