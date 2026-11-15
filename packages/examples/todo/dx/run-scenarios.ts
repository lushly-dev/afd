/**
 * AFD's own clients against the TypeScript backend: serve it over Streamable HTTP with an
 * in-memory store, then run `afd validate --surface --strict` and `afd scenario run` against it,
 * as `endpoints/umbel/tests/scripts/external-clients.sh` does for Umbel.
 *
 * Usage: tsx dx/run-scenarios.ts (after `pnpm build`, which builds the backend and the CLI)
 *
 * Runs every scenario in `scenarios/` and `backends/typescript/scenarios/` except those tagged
 * `deterministic` or `contexts`: they need a fixed clock or an active context, which a server
 * run cannot set, so `src/scenarios.test.ts` and `src/replay.test.ts` run them in-process.
 * Uses a temporary `afd` config home, so the developer's saved connection is never touched.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(__dirname, '..');
const AFD = path.join(EXAMPLE, '../../cli/dist/bin.js');
const SERVER = path.join(EXAMPLE, 'backends/typescript/dist/server.js');
const DIRECTORIES = ['scenarios', 'backends/typescript/scenarios'];
const IN_PROCESS_TAGS = ['deterministic', 'contexts'];

/**
 * Surface findings kept on purpose, as in `backends/typescript/src/surface.test.ts`: the single-id
 * commands all take `{ id }`, and todo-restore takes the ids todo-delete-batch removed because it
 * is its undo.
 */
const SUPPRESSIONS = [
	'schema-overlap:todo-get:todo-toggle',
	'schema-overlap:todo-get:todo-delete',
	'schema-overlap:todo-toggle:todo-delete',
	'schema-overlap:todo-delete-batch:todo-restore',
];

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
	for (let attempt = 0; attempt < 120; attempt++) {
		if (child.exitCode !== null) throw new Error(`The backend exited (${child.exitCode})`);
		try {
			if ((await fetch(`${url}/health`)).ok) return;
		} catch {
			// Not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`The backend did not answer ${url}/health`);
}

/** A scenario file's tags, from its one-line `tags: [a, b]` list. */
function tagsOf(file: string): string[] {
	const line = readFileSync(file, 'utf8').match(/^tags:\s*\[(.*)\]\s*$/m);
	return line?.[1] ? line[1].split(',').map((tag) => tag.trim()) : [];
}

/** The scenario files a server run can check. */
function serverScenarios(): string[] {
	const files: string[] = [];
	for (const directory of DIRECTORIES) {
		const full = path.join(EXAMPLE, directory);
		for (const name of readdirSync(full).filter((file) => file.endsWith('.scenario.yaml'))) {
			const tags = tagsOf(path.join(full, name));
			if (tags.some((tag) => IN_PROCESS_TAGS.includes(tag))) {
				console.log(`- ${directory}/${name}: runs in-process (${tags.join(', ')})`);
				continue;
			}
			files.push(path.join(full, name));
		}
	}
	return files;
}

function afd(args: string[], env: NodeJS.ProcessEnv): number {
	const result = spawnSync(process.execPath, [AFD, ...args], { env, stdio: 'inherit' });
	return result.status ?? 1;
}

async function main(): Promise<number> {
	const port = await freePort();
	const url = `http://127.0.0.1:${port}`;
	const home = mkdtempSync(path.join(tmpdir(), 'todo-afd-home-'));
	const backend = spawn(process.execPath, [SERVER], {
		env: {
			...process.env,
			TRANSPORT: 'http',
			HOST: '127.0.0.1',
			PORT: String(port),
			TODO_STORE_TYPE: 'memory',
		},
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	try {
		await waitForHealth(url, backend);
		const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') };

		let failed = afd(['connect', `${url}/mcp`], env);
		if (failed === 0) {
			failed = afd(
				[
					'validate',
					'--surface',
					'--strict',
					...SUPPRESSIONS.flatMap((rule) => ['--suppress', rule]),
				],
				env
			);
		}
		for (const file of serverScenarios()) {
			console.log(`\n${path.relative(EXAMPLE, file)}`);
			failed ||= afd(['scenario', 'run', file, '--server', `${url}/mcp`], env);
		}
		return failed;
	} finally {
		backend.kill();
		rmSync(home, { recursive: true, force: true });
	}
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error);
		process.exit(1);
	}
);
