#!/usr/bin/env node
/**
 * Record what the Umbel pages show.
 *
 * Umbel is a native program: one MCP server for a repository's agents, built
 * from plugins, with a command line beside it. It cannot run in a browser tab,
 * so the Umbel pages show a real run of it instead, recorded here and never
 * edited. The run does what the pages say Umbel is for:
 *
 * 1. It makes a workspace in `.umbel/site-run/` (ignored by git) with one
 *    plugin that ships with Umbel, `components`, and exports the Specimen
 *    pages' component pack (site/specimen/pack/) into it with
 *    `specimen pack-export`.
 * 2. It adds the repository's own commands as a second plugin: it scaffolds a
 *    mounted plugin with `umbel plugin new`, points the manifest at the todo
 *    example's AFD server (packages/examples/todo), and turns it on.
 * 3. It runs a fixed list of Umbel commands, and one MCP session over stdio,
 *    and writes each line with its exit code and exactly what Umbel printed on
 *    stdout to site/umbel/runs.json, with the manifest and the configuration
 *    as they were used.
 * 4. It copies the exported pack to site/umbel/pack/, so a page can recompute
 *    the digest Umbel printed from the files themselves.
 *
 * A result that names this machine's paths is refused: `workspace show` and
 * `workspace doctor` name the workspace's directory, so they are not recorded.
 *
 * Both outputs are committed, so the site deploys without an Umbel build. Run
 * it again when Umbel, Specimen, the todo example or the bench project changes:
 *
 *   node scripts/build-site-specimen.mjs
 *   pnpm -F "@afd/example-todo-ts..." build
 *   cd endpoints/umbel && cargo build --locked -p umbel-first-party --features umbel/mounted
 *   node scripts/build-site-umbel.mjs
 *
 * `--features umbel/mounted` matters: the first-party binary is built without a
 * loader by default, and would refuse the mounted plugin.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCargoTargetDir } from './cargo-target.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specimen = join(root, 'endpoints/specimen-cli/dist/bin.js');
const todoServer = 'packages/examples/todo/backends/typescript/dist/server.js';
const bench = join(root, 'site/specimen/bench');
const out = join(root, 'site/umbel');
const exe = process.platform === 'win32' ? '.exe' : '';

/** The newest build of the binary with the first-party plugins compiled in, release before debug. */
function findUmbel() {
	const umbelRoot = join(root, 'endpoints/umbel');
	const targets = [
		...new Set(
			[
				process.env.UMBEL_TARGET_DIR?.trim() ? resolve(process.env.UMBEL_TARGET_DIR.trim()) : null,
				resolveCargoTargetDir(umbelRoot),
				join(umbelRoot, 'target'),
			].filter(Boolean)
		),
	];
	for (const profile of ['release', 'debug']) {
		const found = targets
			.map((target) => join(target, profile, `umbel-first-party${exe}`))
			.filter((path) => existsSync(path))
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
		if (found.length) return found[0];
	}
	return null;
}

const umbel = process.env.UMBEL_FIRST_PARTY ?? findUmbel();
const missing = [
	[
		umbel,
		'umbel-first-party (cd endpoints/umbel && cargo build --locked -p umbel-first-party --features umbel/mounted)',
	],
	[existsSync(specimen), 'the Specimen CLI (pnpm -F @lushly-dev/specimen-cli... build)'],
	[
		existsSync(join(root, 'site/specimen/pack')),
		'site/specimen/pack (node scripts/build-site-specimen.mjs)',
	],
	[
		existsSync(join(root, todoServer)),
		'the todo example (pnpm -F "@afd/example-todo-ts..." build)',
	],
].filter(([present]) => !present);
if (missing.length) {
	console.error(`Needs ${missing.map(([, what]) => what).join('; ')}.`);
	process.exit(1);
}

/** Anything that names a place on this machine. */
const LOCAL = /[A-Za-z]:\\\\|\/Users\/|\/home\/|\/tmp\/|\/var\/folders\//;

function keep(id, text) {
	if (LOCAL.test(text)) throw new Error(`${id} names a local path; it cannot be published.`);
	return text;
}

// ── A workspace inside the repository, so a plugin can name the repo's own server ──

const workspace = join(root, '.umbel/site-run');
rmSync(workspace, { recursive: true, force: true });
const override = join(workspace, 'spaces/main/packs/components/library');
mkdirSync(override, { recursive: true });

const run = (id, line, args) => {
	const result = spawnSync(umbel, args, { cwd: workspace, encoding: 'utf8', timeout: 60_000 });
	// Every command prints one CommandResult. If one does not parse, the run is wrong.
	JSON.parse(result.stdout);
	console.log(`${result.status === 0 ? 'ok    ' : `exit ${result.status}`}  ${line}`);
	return { id, line, exit: result.status, stdout: keep(id, result.stdout) };
};

/** The workspace's configuration: which plugins are on, and where each comes from. */
const config = (withApp) => `config_version = 4
default_space = "main"

[principal]
local_id = "agent"
on_behalf_of = "agent"

[plugins]
enabled = [${withApp ? '"components", "app"' : '"components"'}]

# A plugin that ships with Umbel, compiled into the binary.
[plugins.components]
source = "compiled:components"
${
	withApp
		? `
# This repository's own commands: a directory holding a manifest.
[plugins.app]
source = "plugins/app"
${
	process.platform === 'win32'
		? `
# Windows only: a child process needs this to seed its random numbers.
[plugins.app.env]
SystemRoot = ${JSON.stringify(process.env.SystemRoot)}
`
		: ''
}`
		: ''
}`;

writeFileSync(join(workspace, 'umbel.toml'), config(false));
writeFileSync(
	join(override, 'pack.toml'),
	`pack_version = 1
id = "library"
plugin = "components"
version = "1.0.0"
title = "Component libraries"
description = "The component library this space's agents are briefed on."
`
);
const exported = JSON.parse(
	execFileSync(process.execPath, [specimen, 'pack-export', override], {
		cwd: bench,
		encoding: 'utf8',
	})
);
if (!exported.success) {
	console.error(JSON.stringify(exported, null, 2));
	process.exit(1);
}

// ── The repository's own commands, as a second plugin ──────────────────

const scaffold = run('scaffold', 'umbel plugin new kind=mounted id=app dir=plugins/app', [
	'plugin',
	'new',
	'kind=mounted',
	'id=app',
	'dir=plugins/app',
]);
const manifestPath = join(workspace, 'plugins/app/umbel-plugin.toml');
const scaffolded = readFileSync(manifestPath, 'utf8');
// The two things a person changes: where the server is, and what it needs in its environment.
// From plugins/app, four levels up is the repository's root.
const edited = scaffolded.replace(
	'command = ["bin/app-mcp"]',
	`command = ["node", "../../../../${todoServer}"]\n# The example keeps its list in a file beside this manifest.\nenv = { TODO_STORE_TYPE = "file", TODO_STORE_PATH = "todos.json" }`
);
if (edited === scaffolded)
	throw new Error('The scaffold no longer writes the command line this script edits.');
writeFileSync(manifestPath, edited);
const check = run('check', 'umbel plugin check path=plugins/app', [
	'plugin',
	'check',
	'path=plugins/app',
]);
writeFileSync(join(workspace, 'umbel.toml'), config(true));

// ── The run ─────────────────────────────────────────────────────────────

/** A page as an agent would pass it: the bar, and a tag the agent guessed that the library lacks. */
const PAGE =
	'<main><change-bar save-disabled>2 changes to Ledger</change-bar><change-banner></change-banner></main>';
const CREATE = '{"action":"create","params":{"title":"Ship the Umbel page"}}';

/** Each line as a person types it, and the arguments the program gets. */
const LINES = [
	['help', 'umbel help', ['help']],
	['plugin-list', 'umbel plugin list', ['plugin', 'list']],
	['plugin-show', 'umbel plugin show plugin=components', ['plugin', 'show', 'plugin=components']],
	['app-show', 'umbel plugin show plugin=app', ['plugin', 'show', 'plugin=app']],
	['skill-list', 'umbel skill list', ['skill', 'list']],
	[
		'brief',
		`umbel call components-brief '{"tags":["change-bar"],"render":"text"}'`,
		['call', 'components-brief', '{"tags":["change-bar"],"render":"text"}'],
	],
	[
		'brief-source',
		`umbel call components-brief '{"source":"${PAGE}"}'`,
		['call', 'components-brief', JSON.stringify({ source: PAGE })],
	],
	['list', `umbel call components-list '{}'`, ['call', 'components-list', '{}']],
	[
		'open',
		`umbel call components-open '{"tag":"change-bar"}'`,
		['call', 'components-open', '{"tag":"change-bar"}'],
	],
	['refused', `umbel call components-brief '{}'`, ['call', 'components-brief', '{}']],
	['app-create', `umbel call app-todo '${CREATE}'`, ['call', 'app-todo', CREATE]],
	[
		'app-list',
		`umbel call app-todo '{"action":"list"}'`,
		['call', 'app-todo', '{"action":"list"}'],
	],
	['events', 'umbel event list', ['event', 'list']],
];

const runs = [scaffold, check, ...LINES.map(([id, line, args]) => run(id, line, args))];

// The same host, as an agent's harness reaches it: MCP over stdio.
const requests = [
	{
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'afd-site', version: '1' },
		},
	},
	{ jsonrpc: '2.0', method: 'notifications/initialized' },
	{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
	{
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/call',
		params: { name: 'components-brief', arguments: { tags: ['change-bar'], render: 'text' } },
	},
];
const session = spawnSync(umbel, ['serve', '--stdio'], {
	cwd: workspace,
	encoding: 'utf8',
	input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
	timeout: 60_000,
});
const responses = session.stdout
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(keep('mcp', line)));
if (responses.length !== 3)
	throw new Error(`The MCP session answered ${responses.length} of 3 requests.`);
console.log('ok      umbel serve --stdio (initialize, tools/list, tools/call)');

// What produced it. `workspace show` names the workspace's directory, so only these fields are read.
const host = JSON.parse(
	spawnSync(umbel, ['workspace', 'show'], { cwd: workspace, encoding: 'utf8' }).stdout
).data.host;
const git = (...args) =>
	execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd: root, encoding: 'utf8' }).trim();

rmSync(join(out, 'pack'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(override, join(out, 'pack'), { recursive: true });
writeFileSync(
	join(out, 'runs.json'),
	`${JSON.stringify(
		{
			recorded: new Date().toISOString(),
			host,
			source: { revision: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' },
			// SystemRoot names this machine's Windows directory; the record says <SystemRoot>.
			workspace: {
				config: config(true).replace(
					JSON.stringify(process.env.SystemRoot ?? ''),
					'"<SystemRoot>"'
				),
				pack: exported.data.files,
			},
			plugin: { scaffolded, manifest: edited, server: todoServer },
			runs,
			mcp: { line: 'umbel serve --stdio', requests, responses },
		},
		null,
		'\t'
	)}\n`
);
rmSync(workspace, { recursive: true, force: true });
console.log(`Recorded ${runs.length} commands and one MCP session → site/umbel/runs.json`);
