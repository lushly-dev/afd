#!/usr/bin/env node
/**
 * Serves FAST-AF's component briefs to agents in this repository: a locally built
 * `umbel-first-party` over MCP stdio, with only the `components` plugin enabled and
 * `violet-elements`' pack exported (`specimen pack-export`) into the space override each time it
 * starts (Component Briefs, step C5).
 *
 *   node scripts/umbel-components.mjs [serve]   export, then `umbel-first-party serve --stdio`
 *   node scripts/umbel-components.mjs prepare   export only, and print what would be served as JSON
 *
 * It never builds anything. Build the binary once, from `endpoints/umbel`:
 *   cargo build --locked --release -p umbel-first-party
 * and Specimen's CLI with `pnpm build` (or `pnpm -F @lushly-dev/specimen-cli... build`).
 *
 * Environment:
 *   UMBEL_FIRST_PARTY            the binary; otherwise the newest of release then debug under
 *                                $CARGO_TARGET_DIR and endpoints/umbel/target
 *   UMBEL_COMPONENTS_WORKSPACE   the Umbel workspace; default `.umbel/components` in this checkout
 *
 * Stdout carries only the server's JSON-RPC; everything this script says goes to stderr. When the
 * export fails (a record no longer matches the manifest or guides, or the CLI is not built), it
 * does not start: a brief from a stale export would be wrong exactly where the code changed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY = 'foundations/fast-af/packages/violet-elements';
export const SPECIMEN_CLI = 'endpoints/specimen-cli/dist/bin.js';
export const BINARY = 'umbel-first-party';
export const SPACE = 'main';

/** The workspace's configuration: one space, the `components` plugin alone. */
export const UMBEL_TOML = `# Written by scripts/umbel-components.mjs on every start; edits are overwritten.
config_version = 4
default_space = "${SPACE}"

[principal]
local_id = "agent"
on_behalf_of = "agent"

[plugins]
enabled = ["components"]

[plugins.components]
source = "compiled:components"
`;

/** The override's pack.toml (the plugin's README); export carries it across. */
export const PACK_TOML = `pack_version = 1
id = "library"
plugin = "components"
version = "1.0.0"
title = "Component libraries"
description = "FAST-AF's violet-elements, exported from this checkout by scripts/umbel-components.mjs."
`;

/** Where the override lives in a workspace. */
export const overrideDirectory = (workspace) =>
	join(workspace, 'spaces', SPACE, 'packs', 'components', 'library');

/** The binaries to try, most preferred first: an explicit one, then release before debug. */
export function binaryCandidates(environment = process.env, root = REPO_ROOT) {
	if (environment.UMBEL_FIRST_PARTY) return [resolve(environment.UMBEL_FIRST_PARTY)];
	const targets = [environment.CARGO_TARGET_DIR, join(root, 'endpoints/umbel/target')].filter(
		Boolean
	);
	return ['release', 'debug'].flatMap((profile) =>
		targets.map((target) => join(resolve(target), profile, BINARY))
	);
}

/** The first profile that has a binary, and within it the newest. */
export function findBinary(
	candidates,
	stat = (path) => (existsSync(path) ? statSync(path) : null)
) {
	const found = candidates
		.map((path) => ({ path, stats: stat(path) }))
		.filter(({ stats }) => stats?.isFile());
	if (found.length === 0) return null;
	const profileOf = (path) => (path.includes('/release/') ? 'release' : 'debug');
	const best = profileOf(found[0].path);
	return found
		.filter(({ path }) => profileOf(path) === best)
		.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)[0].path;
}

/** Writes the configuration and the override's pack.toml; returns the override's directory. */
export function prepareWorkspace(workspace) {
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(workspace, 'umbel.toml'), UMBEL_TOML);
	const override = overrideDirectory(workspace);
	mkdirSync(override, { recursive: true });
	const packToml = join(override, 'pack.toml');
	if (!existsSync(packToml)) writeFileSync(packToml, PACK_TOML);
	return override;
}

/** Runs `specimen pack-export` into the override; returns its parsed CommandResult. */
export function exportPack(override, root = REPO_ROOT) {
	const cli = join(root, SPECIMEN_CLI);
	if (!existsSync(cli))
		return {
			success: false,
			error: {
				code: 'SPECIMEN_CLI_NOT_BUILT',
				message: `${SPECIMEN_CLI} does not exist`,
				suggestion: 'Run `pnpm build` (or build @lushly-dev/specimen-cli and its dependencies).',
			},
		};
	const started = Date.now();
	const run = spawnSync(process.execPath, [cli, 'pack-export', override], {
		cwd: join(root, LIBRARY),
		encoding: 'utf8',
	});
	try {
		return { ...JSON.parse(run.stdout), elapsedMs: Date.now() - started };
	} catch {
		return {
			success: false,
			error: {
				code: 'PACK_EXPORT_FAILED',
				message: (run.stderr || run.stdout || `exit ${run.status}`).trim().slice(0, 2000),
				suggestion: 'Run the export by hand from the library to see the whole answer.',
			},
		};
	}
}

function say(text) {
	process.stderr.write(`umbel-components: ${text}\n`);
}

function prepare() {
	const workspace = resolve(
		process.env.UMBEL_COMPONENTS_WORKSPACE ?? join(REPO_ROOT, '.umbel', 'components')
	);
	const binary = findBinary(binaryCandidates());
	const override = prepareWorkspace(workspace);
	const exported = exportPack(override);
	return { workspace, binary, override, exported };
}

async function main() {
	const mode = process.argv[2] ?? 'serve';
	if (mode !== 'serve' && mode !== 'prepare') {
		say('usage: node scripts/umbel-components.mjs [serve | prepare]');
		process.exit(2);
	}
	const { workspace, binary, override, exported } = prepare();
	if (!exported.success) {
		say(`the export failed, so nothing is served: ${JSON.stringify(exported.error)}`);
		process.exit(1);
	}
	if (mode === 'prepare') {
		process.stdout.write(
			`${JSON.stringify(
				{
					workspace,
					override,
					binary,
					library: exported.data?.library,
					digest: exported.data?.digest,
					files: exported.data?.files?.length,
					exportMs: exported.elapsedMs,
				},
				null,
				'\t'
			)}\n`
		);
		return;
	}
	if (!binary) {
		say(
			`no ${BINARY} binary found (tried ${binaryCandidates().join(', ')}). Build it from endpoints/umbel with \`cargo build --locked --release -p umbel-first-party\`, or set UMBEL_FIRST_PARTY.`
		);
		process.exit(1);
	}
	say(
		`exported ${exported.data.library} (${exported.data.digest}) in ${exported.elapsedMs} ms; serving ${binary}`
	);
	const child = spawn(binary, ['serve', '--stdio', '--workspace', workspace], {
		stdio: 'inherit',
	});
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
		process.on(signal, () => child.kill(signal));
	child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
