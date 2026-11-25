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
 *                                $UMBEL_TARGET_DIR, Cargo's effective target-dir ($CARGO_TARGET_DIR,
 *                                $CARGO_BUILD_TARGET_DIR or `[build] target-dir`), and
 *                                endpoints/umbel/target
 *   UMBEL_TARGET_DIR             an Umbel-specific Cargo target directory to search before
 *                                Cargo's effective target-dir and endpoints/umbel/target
 *   UMBEL_COMPONENTS_WORKSPACE   the Umbel workspace; default `.umbel/components` in this checkout,
 *                                or, when either consumer variable below is set,
 *                                `.umbel/components-<hash of what they deploy>`, so a start with
 *                                other consumers never rewrites the map another server reads
 *   UMBEL_COMPONENTS_LIBRARIES   more libraries to serve beside violet-elements, as directories
 *                                separated by the platform's path delimiter. Each holds a
 *                                `specimen.config.json` with a `pack` section and its committed pack,
 *                                and is exported after violet-elements (Component Briefs step D3)
 *   UMBEL_COMPONENTS_CONSUMERS   a consumers file (version 1 or 2, the components plugin's
 *                                `data/consumers.json` form) whose profiles are added to the
 *                                repository's own; a name the repository already configures
 *                                refuses to start. With it, the map written is version 2
 *   UMBEL_COMPONENTS_CONSUMER    the consumer a brief uses when a call names none: written as
 *                                `default_consumer` in `[plugins.components.config]`. It must be a
 *                                consumer the repository or UMBEL_COMPONENTS_CONSUMERS configures
 *
 * Stdout carries only the server's JSON-RPC; everything this script says goes to stderr. When an
 * export fails (a record no longer matches the manifest or guides, or the CLI is not built), it
 * does not start: a brief from a stale export would be wrong exactly where the code changed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCargoTargetDir } from './cargo-target.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY = 'foundations/fast-af/packages/violet-elements';
export const SPECIMEN_CLI = 'endpoints/specimen-cli/dist/bin.js';
export const BINARY = 'umbel-first-party';
export const SPACE = 'main';
export const CONSUMERS = {
	version: 1,
	consumers: {
		loam: { exclude_rules: ['violet-elements/import.root', 'violet-elements/theme.install'] },
	},
};
export const CONSUMERS_TOML = `pack_version = 1
id = "consumers"
plugin = "components"
version = "1.0.0"
title = "Component consumers"
description = "Repository consumer policy."
`;

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

/** A consumer name, as the plugin checks it: the library-id pattern. */
const CONSUMER_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** A statement id and a rule id, the pack format's id pattern (at most 128 characters). */
const STATEMENT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
/** What a one-line text refuses: C0 and C1 controls, DEL, bidirectional embeddings and isolates. */
const oneLine = (text) =>
	[...text].every((character) => {
		const code = character.codePointAt(0);
		return !(
			code <= 0x1f ||
			(code >= 0x7f && code <= 0x9f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		);
	});
/** The plugin's limits on a profile's statements: count, and UTF-8 bytes of ids and text. */
export const MAX_STATEMENTS = 24;
export const MAX_STATEMENT_BYTES = 4096;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Whether an added profile keeps the plugin's rules, checked before anything is served so that
 * a bad deployment file refuses to start instead of failing every call that reads the map
 * (Loam's included). The plugin checks again on every call; only its identifier scan is not
 * repeated here. Never echoes a statement's text.
 */
function profileOk(version, name, profile) {
	if (!CONSUMER_NAME.test(name) || !isObject(profile)) return false;
	const keys = Object.keys(profile);
	if (keys.some((key) => key !== 'exclude_rules' && key !== 'statements')) return false;
	if (
		version === 1 &&
		(!Object.hasOwn(profile, 'exclude_rules') || Object.hasOwn(profile, 'statements'))
	)
		return false;
	const rules = profile.exclude_rules ?? [];
	if (Object.hasOwn(profile, 'exclude_rules') && !Array.isArray(profile.exclude_rules))
		return false;
	if (
		rules.length > 256 ||
		!rules.every((rule) => {
			if (typeof rule !== 'string') return false;
			const [library, id, more] = rule.split('/');
			return (
				more === undefined &&
				CONSUMER_NAME.test(library ?? '') &&
				STATEMENT_ID.test(id ?? '') &&
				id.length <= 128
			);
		})
	)
		return false;
	if (Object.hasOwn(profile, 'statements') && !Array.isArray(profile.statements)) return false;
	const statements = profile.statements ?? [];
	if (statements.length > MAX_STATEMENTS) return false;
	const ids = new Set();
	let bytes = 0;
	for (const statement of statements) {
		if (
			!isObject(statement) ||
			Object.keys(statement).some((key) => key !== 'id' && key !== 'text')
		)
			return false;
		const { id, text } = statement;
		if (typeof id !== 'string' || typeof text !== 'string') return false;
		const length = [...text].length;
		if (!STATEMENT_ID.test(id) || id.length > 128 || ids.has(id)) return false;
		if (length < 1 || length > 240 || !oneLine(text)) return false;
		ids.add(id);
		bytes += Buffer.byteLength(id) + Buffer.byteLength(text);
	}
	return bytes <= MAX_STATEMENT_BYTES;
}

const refused = (code, message, suggestion) => ({
	success: false,
	error: { code, message, suggestion },
});

/**
 * What the workspace deploys, from UMBEL_COMPONENTS_CONSUMERS and UMBEL_COMPONENTS_CONSUMER: the
 * consumers map and `umbel.toml`. Without either, both are exactly CONSUMERS and UMBEL_TOML. The
 * plugin checks each profile's contents itself, on every call and in the doctor; this checks only
 * what decides the files: the file's shape, a name clash and the default's name.
 */
export function deployment(
	environment = process.env,
	readFile = (path) => readFileSync(path, 'utf8')
) {
	let consumers = CONSUMERS;
	const file = environment.UMBEL_COMPONENTS_CONSUMERS?.trim();
	if (file) {
		const shape =
			'Point UMBEL_COMPONENTS_CONSUMERS at a consumers file: {"version":2,"consumers":{"<name>":{"statements":[{"id":"<pattern>.<kind>.<name>","text":"..."}]}}}; see the components plugin\'s README.';
		let added;
		try {
			added = JSON.parse(readFile(resolve(file)));
		} catch {
			return refused('CONSUMERS_UNREADABLE', `${file} is not a readable JSON file`, shape);
		}
		const profiles = added?.consumers;
		const isMap = profiles !== null && typeof profiles === 'object' && !Array.isArray(profiles);
		if (
			![1, 2].includes(added?.version) ||
			!isMap ||
			(added.version === 1 &&
				Object.values(profiles).some(
					(profile) =>
						!Array.isArray(profile?.exclude_rules) || Object.hasOwn(profile, 'statements')
				))
		)
			return refused(
				'CONSUMERS_INVALID',
				`${file} is not a consumers map of version 1 or 2 (a version 1 profile has exclude_rules and no statements)`,
				shape
			);
		const bad = Object.entries(profiles)
			.filter(([name, profile]) => !profileOk(added.version, name, profile))
			.map(([name]) =>
				CONSUMER_NAME.test(name) ? name : 'a profile whose name is not a consumer name'
			);
		if (bad.length > 0)
			return refused(
				'CONSUMERS_INVALID',
				`${file} has a profile the components plugin would refuse: ${bad.join(', ')}`,
				`Repair the profile: a consumer name of lowercase letters, digits and hyphens; exclude_rules as <library>/<rule-id>, at most 256; at most ${MAX_STATEMENTS} statements, each {"id","text"} with a unique id of the pack's statement-id pattern and one line of 1 to 240 characters, ${MAX_STATEMENT_BYTES} bytes of ids and text in all. ${shape}`
			);
		const clash = Object.keys(profiles).filter((name) => Object.hasOwn(CONSUMERS.consumers, name));
		if (clash.length > 0)
			return refused(
				'CONSUMER_CLASH',
				`${file} configures ${clash.join(', ')}, which the repository already configures`,
				"Rename the consumer in UMBEL_COMPONENTS_CONSUMERS; the repository's own profiles are kept as they are."
			);
		consumers = { version: 2, consumers: { ...CONSUMERS.consumers, ...profiles } };
	}
	let umbelToml = UMBEL_TOML;
	const name = environment.UMBEL_COMPONENTS_CONSUMER?.trim();
	if (name) {
		if (!CONSUMER_NAME.test(name))
			return refused(
				'CONSUMER_INVALID',
				'UMBEL_COMPONENTS_CONSUMER is not a consumer name',
				'Use a name of lowercase letters, digits and hyphens, starting with a letter, at most 64 characters.'
			);
		if (!Object.hasOwn(consumers.consumers, name))
			return refused(
				'CONSUMER_NOT_FOUND',
				`UMBEL_COMPONENTS_CONSUMER names ${name}, which no consumers map configures`,
				`Set UMBEL_COMPONENTS_CONSUMER to one the repository configures (${Object.keys(CONSUMERS.consumers).join(', ')}) or one the file UMBEL_COMPONENTS_CONSUMERS names configures, or add the profile to that file.`
			);
		umbelToml = `${UMBEL_TOML}\n[plugins.components.config]\ndefault_consumer = "${name}"\n`;
	}
	return { success: true, data: { consumers, umbelToml } };
}

/**
 * The workspace a start uses: UMBEL_COMPONENTS_WORKSPACE, else `.umbel/components` when the
 * repository's own consumers and configuration are deployed, else a workspace keyed by a hash of
 * what is deployed. The host reads pack files on every call, so two servers sharing a workspace
 * with different consumers would each rewrite the map the other reads.
 */
export function workspaceFor(deployed, environment = process.env, root = REPO_ROOT) {
	if (environment.UMBEL_COMPONENTS_WORKSPACE)
		return resolve(environment.UMBEL_COMPONENTS_WORKSPACE);
	const own = deployed.consumers === CONSUMERS && deployed.umbelToml === UMBEL_TOML;
	if (own) return join(root, '.umbel', 'components');
	const hash = createHash('sha256')
		.update(JSON.stringify(deployed.consumers))
		.update('\0')
		.update(deployed.umbelToml)
		.digest('hex')
		.slice(0, 12);
	return join(root, '.umbel', `components-${hash}`);
}

/** The override's pack.toml (the plugin's README); export carries it across. */
export const PACK_TOML = `pack_version = 1
id = "library"
plugin = "components"
version = "1.0.0"
title = "Component libraries"
description = "FAST-AF's violet-elements and any UMBEL_COMPONENTS_LIBRARIES, exported by scripts/umbel-components.mjs."
`;

/** The library directories to export, violet-elements first, then UMBEL_COMPONENTS_LIBRARIES'. */
export function libraryDirectories(environment = process.env, root = REPO_ROOT) {
	const more = (environment.UMBEL_COMPONENTS_LIBRARIES ?? '')
		.split(delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => resolve(entry));
	return [...new Set([join(root, LIBRARY), ...more])];
}

/**
 * Removes the libraries in the override that this start did not export. Each export copies the
 * libraries already there into its result, so a library dropped from UMBEL_COMPONENTS_LIBRARIES
 * would otherwise be served from its last export for good.
 */
export function pruneLibraries(override, keep) {
	const removed = [];
	const data = join(override, 'data');
	for (const name of existsSync(data) ? readdirSync(data) : []) {
		if (keep.includes(name)) continue;
		rmSync(join(data, name), { recursive: true, force: true });
		rmSync(join(override, 'rules', `${name}.json`), { force: true });
		removed.push(name);
	}
	return removed;
}

/** Where the override lives in a workspace. */
export const overrideDirectory = (workspace) =>
	join(workspace, 'spaces', SPACE, 'packs', 'components', 'library');

/** The binary's file name on `platform`: cargo adds `.exe` on Windows. */
export const binaryName = (platform = process.platform) =>
	platform === 'win32' ? `${BINARY}.exe` : BINARY;

/** The binaries to try, most preferred first: an explicit one, then release before debug. */
export function binaryCandidates(
	environment = process.env,
	root = REPO_ROOT,
	platform = process.platform
) {
	if (environment.UMBEL_FIRST_PARTY) return [resolve(environment.UMBEL_FIRST_PARTY)];
	const umbelRoot = join(resolve(root), 'endpoints/umbel');
	const targets = [
		...new Set(
			[
				environment.UMBEL_TARGET_DIR?.trim() ? resolve(environment.UMBEL_TARGET_DIR.trim()) : null,
				resolveCargoTargetDir(umbelRoot, { env: environment }),
				join(umbelRoot, 'target'),
			].filter(Boolean)
		),
	];
	return ['release', 'debug'].flatMap((profile) =>
		targets.map((target) => join(resolve(target), profile, binaryName(platform)))
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
	// By the binary's own directory, `target/release` or `target/debug`, never a `release` directory higher in the
	// checkout's path. Either separator: `join` writes Windows paths with backslashes.
	const profileOf = (path) => (path.split(/[\\/]/).at(-2) === 'release' ? 'release' : 'debug');
	const best = profileOf(found[0].path);
	return found
		.filter(({ path }) => profileOf(path) === best)
		.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)[0].path;
}

/**
 * Writes the configuration, the consumers pack and the override's pack.toml; returns the
 * override's directory. The second argument is `deployment(...).data`; by default, the
 * repository's own.
 */
export function prepareWorkspace(
	workspace,
	{ consumers: map = CONSUMERS, umbelToml = UMBEL_TOML } = {}
) {
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(workspace, 'umbel.toml'), umbelToml);
	const consumers = join(workspace, 'spaces', SPACE, 'packs', 'components', 'consumers');
	mkdirSync(join(consumers, 'data'), { recursive: true });
	writeFileSync(join(consumers, 'pack.toml'), CONSUMERS_TOML);
	writeFileSync(join(consumers, 'data', 'consumers.json'), `${JSON.stringify(map)}\n`);
	const override = overrideDirectory(workspace);
	mkdirSync(override, { recursive: true });
	const packToml = join(override, 'pack.toml');
	if (!existsSync(packToml)) writeFileSync(packToml, PACK_TOML);
	return override;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Runs `work` holding the directory `lock` (the workspace's `export.lock`, outside the packs the host
 * reads), so two sessions starting in one checkout do not export at once. A lock older than `staleMs`
 * is a crashed start's, and taken.
 */
export function withLock(lock, work, { waitMs = 30_000, staleMs = 60_000 } = {}) {
	const until = Date.now() + waitMs;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
			if (age > staleMs) rmSync(lock, { recursive: true, force: true });
			else if (Date.now() > until)
				return {
					success: false,
					error: {
						code: 'PACK_EXPORT_BUSY',
						message: `another start holds ${lock}`,
						suggestion:
							'Start again once the other session has started, or remove the lock if none is running.',
					},
				};
			else sleep(100);
		}
	}
	try {
		return work();
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
}

/** Runs `specimen pack-export` from `library` into the override; returns its parsed CommandResult. */
export function exportPack(override, root = REPO_ROOT, library = join(root, LIBRARY)) {
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
	if (!existsSync(join(library, 'specimen.config.json')))
		return {
			success: false,
			error: {
				code: 'LIBRARY_NOT_FOUND',
				message: `${library} has no specimen.config.json`,
				suggestion:
					'Check UMBEL_COMPONENTS_LIBRARIES: each entry is a library directory whose specimen.config.json has a pack section.',
			},
		};
	const run = spawnSync(process.execPath, [cli, 'pack-export', override], {
		cwd: library,
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
				suggestion: `Run \`node ${cli} pack-export <dir>\` by hand from ${library} to see the whole answer.`,
			},
		};
	}
}

function say(text) {
	process.stderr.write(`umbel-components: ${text}\n`);
}

function prepare(deployed) {
	const workspace = workspaceFor(deployed);
	const override = prepareWorkspace(workspace, deployed);
	const exported = withLock(join(workspace, 'export.lock'), () => {
		const results = [];
		for (const library of libraryDirectories()) {
			const result = exportPack(override, REPO_ROOT, library);
			if (!result.success) return { ...result, library };
			results.push(result);
		}
		const removed = pruneLibraries(
			override,
			results.map((result) => result.data.library)
		);
		return { success: true, results, removed };
	});
	return { workspace, override, exported };
}

async function main() {
	const mode = process.argv[2] ?? 'serve';
	if (mode !== 'serve' && mode !== 'prepare') {
		say('usage: node scripts/umbel-components.mjs [serve | prepare]');
		process.exit(2);
	}
	const binary = findBinary(binaryCandidates());
	if (!binary && mode === 'serve') {
		say(
			`no ${BINARY} binary found (tried ${binaryCandidates().join(', ')}). Build it from endpoints/umbel with \`cargo build --locked --release -p umbel-first-party\`, or set UMBEL_FIRST_PARTY.`
		);
		process.exit(1);
	}
	const deployed = deployment();
	if (!deployed.success) {
		say(
			`the consumers could not be deployed, so nothing is served: ${JSON.stringify(deployed.error)}`
		);
		process.exit(1);
	}
	const { workspace, override, exported } = prepare(deployed.data);
	if (!exported.success) {
		say(
			`the export${exported.library ? ` of ${exported.library}` : ''} failed, so nothing is served: ${JSON.stringify(exported.error)}`
		);
		process.exit(1);
	}
	if (mode === 'prepare') {
		process.stdout.write(
			`${JSON.stringify(
				{
					workspace,
					override,
					binary,
					libraries: exported.results.map(({ data, elapsedMs }) => ({
						library: data.library,
						digest: data.digest,
						files: data.files.length,
						exportMs: elapsedMs,
					})),
					removed: exported.removed,
				},
				null,
				'\t'
			)}\n`
		);
		return;
	}
	const libraries = exported.results
		.map(({ data, elapsedMs }) => `${data.library} (${data.digest}) in ${elapsedMs} ms`)
		.join(', ');
	say(`exported ${libraries}; serving ${binary}`);
	const child = spawn(binary, ['serve', '--stdio', '--workspace', workspace], {
		stdio: 'inherit',
	});
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
		process.on(signal, () => child.kill(signal));
	child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
