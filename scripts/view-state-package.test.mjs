import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');

function isWithin(directory, path) {
	const fromDirectory = relative(directory, path);
	return !isAbsolute(fromDirectory) && fromDirectory.split(sep)[0] !== '..';
}

function packPackage(directory, artifacts) {
	execFileSync('pnpm', ['--dir', directory, 'build'], { cwd: repoRoot, stdio: 'pipe' });
	const source = join(repoRoot, directory);
	const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
	const destination = join(artifacts, manifest.name.replace('/', '-'));
	mkdirSync(destination);
	execFileSync('pnpm', ['pack', '--pack-destination', destination], {
		cwd: source,
		stdio: 'pipe',
	});
	const archives = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
	assert.equal(archives.length, 1);
	return { name: manifest.name, archive: join(destination, archives[0]) };
}

function unpackPackage({ name, archive }, consumer) {
	const destination = join(consumer, 'node_modules', ...name.split('/'));
	mkdirSync(destination, { recursive: true });
	execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
	assert.equal(existsSync(join(destination, 'src')), false, 'consume packed dist, not sources');
}

// Copy real dependency contents instead of linking workspace node_modules.
function copyExternalPackage(name, consumer, resolver = require) {
	const source = dirname(resolver.resolve(`${name}/package.json`));
	const destination = join(consumer, 'node_modules', ...name.split('/'));
	if (existsSync(destination)) return;
	cpSync(source, destination, {
		recursive: true,
		dereference: true,
		filter: (path) => !relative(source, path).split(/[\\/]/).includes('node_modules'),
	});
	const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
	for (const dependency of Object.keys(manifest.dependencies ?? {})) {
		copyExternalPackage(dependency, consumer, createRequire(join(source, 'package.json')));
	}
}

function checkConsumer(consumer, name, source) {
	const entry = `${name}.ts`;
	writeFileSync(join(consumer, entry), source);
	writeFileSync(
		join(consumer, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				skipLibCheck: false,
				noEmit: true,
				target: 'ES2022',
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				types: ['node'],
				typeRoots: ['./node_modules/@types'],
			},
			files: [entry],
		})
	);
	const files = execFileSync(process.execPath, [compiler, '-p', consumer, '--listFiles'], {
		cwd: consumer,
		encoding: 'utf8',
		stdio: 'pipe',
	});
	const declarations = files.split(/\r?\n/).filter((path) => path.includes('@lushly-dev'));
	assert.ok(declarations.length > 0, 'compiler must load the package declarations');
	for (const reportedPath of declarations) {
		const path = resolve(reportedPath);
		assert.ok(
			isWithin(join(consumer, 'node_modules'), path),
			`declaration escaped consumer: ${path}`
		);
		assert.ok(path.endsWith('.d.ts'), `expected built declaration: ${path}`);
		assert.equal(
			resolve(realpathSync(path)),
			path,
			`declaration must not resolve through a symlink: ${path}`
		);
	}
}

test('packed view-state declarations support absent and present optional persistence peers', () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'afd-view-state-package-')));
	try {
		assert.ok(!isWithin(realpathSync(repoRoot), root), 'consumer must be outside the workspace');
		const artifacts = join(root, 'artifacts');
		mkdirSync(artifacts);
		const packages = ['core', 'server', 'view-state', 'local-db'].map((name) =>
			packPackage(`packages/${name}`, artifacts)
		);
		const consumer = join(root, 'consumer');
		mkdirSync(consumer);
		writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
		for (const package_ of packages.slice(0, 3)) unpackPackage(package_, consumer);
		copyExternalPackage(
			'zod',
			consumer,
			createRequire(join(repoRoot, 'packages/server/package.json'))
		);
		copyExternalPackage('@types/node', consumer);
		const peerDirectory = join(consumer, 'node_modules/@lushly-dev/local-db');
		assert.equal(existsSync(peerDirectory), false, 'optional peer must be absent');
		checkConsumer(
			consumer,
			'root-absent',
			`import { ViewStateRegistry, type ViewStateRegistryOptions } from '@lushly-dev/afd-view-state';
const options: ViewStateRegistryOptions = {};
const registry = new ViewStateRegistry(options);
registry.register('panel', { get: () => ({ open: true }), set: () => {} });
registry.set('panel', { open: false });
`
		);
		checkConsumer(
			consumer,
			'commands-absent',
			`import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands, type ViewStateCommands } from '@lushly-dev/afd-view-state/commands';
const commands: ViewStateCommands = createViewStateCommands(new ViewStateRegistry());
const name: string = commands[0].name;
`
		);
		assert.equal(existsSync(peerDirectory), false, 'checks must not install the optional peer');
		unpackPackage(packages[3], consumer);
		checkConsumer(
			consumer,
			'peer-present',
			`import { ViewStateRegistry, type ViewStateRegistryOptions } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
import { createMemoryAdapter, createHttpAdapter, type DataAdapter } from '@lushly-dev/local-db';
const toDataAdapter = (value: NonNullable<ViewStateRegistryOptions['adapter']>): DataAdapter => value;
const fromDataAdapter = (value: DataAdapter): NonNullable<ViewStateRegistryOptions['adapter']> => value;
const dataAdapter: DataAdapter = createMemoryAdapter();
const adapter = fromDataAdapter(dataAdapter);
const roundTrip: DataAdapter = toDataAdapter(adapter);
const registry = new ViewStateRegistry({ adapter });
new ViewStateRegistry({ adapter: createHttpAdapter('/api') });
createViewStateCommands(registry);
const list = await adapter.list<{ id: string }>('settings', {
  limit: 10, offset: 0, sort: 'id', order: 'asc', category: 'view-state', enabled: true,
});
const total: number = list.total;
const record = await adapter.get<{ id: string }>('settings', 'panel');
await adapter.create<{ id: string }>('settings', { id: 'panel' });
await adapter.update<{ id: string }>('settings', 'panel', {});
await adapter.remove('settings', 'panel');
const batch = await adapter.batch([{ method: 'PATCH', path: '/settings/panel', body: {} }]);
const failed: number = batch.summary.failed;
const health = await adapter.health();
const uptime: number = health.uptime;
`
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
