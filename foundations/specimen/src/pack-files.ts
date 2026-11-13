import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { LoadedConfig } from './config.js';
import { computeCoverage } from './coverage.js';
import { checkPack, packCatalog, packContentDigest, readPackFiles } from './pack.js';
import { buildPack } from './pack-build.js';
import type { PackComponent, PackRules } from './pack-schema.js';
import type {
	PackBuildRun,
	PackCheckRun,
	PackConfig,
	PackExportRequest,
	PackExportRun,
	PackIndex,
	PackReport,
	PackRun,
} from './types.js';

/**
 * The pack's files on disk: writing a build into the committed form, checking a build against it,
 * and exporting the committed form, with no browser, for a deployment to copy.
 */

const decoder = new TextDecoder();
/** What a pack's root may hold: the format's two directories and the deployment's file. */
const PACK_ENTRIES = new Set(['data', 'rules', 'pack.toml']);

/** The configured pack, or an error that says how to add one. */
export function packConfig(config: LoadedConfig): PackConfig {
	const pack = config.config.pack;
	if (!pack)
		throw new Error(
			'This configuration has no pack key. Add one naming the library, its title, prefix, directory and package.'
		);
	return pack;
}

/** The committed form's root, inside the project. */
export function packDirectory(config: LoadedConfig): string {
	return resolve(dirname(config.file), packConfig(config).directory);
}

/** The committed files of one library: its records and its rules. */
async function committedFiles(directory: string, library: string): Promise<Map<string, string>> {
	const files = existsSync(directory) ? await readPackFiles(directory) : new Map();
	return new Map(
		[...files]
			.filter(
				([path]) =>
					path === `rules/${library}.json` || path.startsWith(`data/${library}/components/`)
			)
			.map(([path, bytes]) => [path, decoder.decode(bytes)])
	);
}

function report(build: PackBuildRun, directory: string): PackReport {
	const { files: _, index: __, ...rest } = build;
	return { ...rest, directory };
}

/** Where a full build keeps its index of the cases each component renders: a cache, not committed. */
export function packIndexPath(config: LoadedConfig): string {
	return join(
		config.root,
		'node_modules',
		'.cache',
		'specimen',
		`pack-${packConfig(config).library}.json`
	);
}

/** The last full build's index, when there is one that reads. */
export async function readPackIndex(config: LoadedConfig): Promise<PackIndex | undefined> {
	try {
		const index = JSON.parse(await readFile(packIndexPath(config), 'utf8')) as PackIndex;
		return typeof index.bundle === 'string' && typeof index.config === 'string' && index.cases
			? index
			: undefined;
	} catch {
		return undefined;
	}
}

/** Keep a full build's index for later one-component builds; a cache that cannot be written is skipped. */
export async function writePackIndex(config: LoadedConfig, build: PackBuildRun): Promise<void> {
	if (!build.index) return;
	try {
		await mkdir(dirname(packIndexPath(config)), { recursive: true });
		await writeFile(packIndexPath(config), `${JSON.stringify(build.index)}\n`);
	} catch {
		// Without it, a one-component build runs every case and says why.
	}
}

/** The committed files a build answers for: every one of the library's, or one record's. */
function answered(before: Map<string, string>, build: PackBuildRun): Map<string, string> {
	const { component } = build.selection;
	if (component === null) return before;
	const path = `data/${build.library}/components/${component}.json`;
	return new Map([...before].filter(([key]) => key === path));
}

/** Why a build may not be written, or `undefined` when it may. */
function refusal(build: PackBuildRun, allowFailed: readonly string[] = []): string | undefined {
	const unnamed = build.cases.failed.filter((item) => !allowFailed.includes(item.id));
	if (unnamed.length)
		return `${unnamed.length} case${unnamed.length === 1 ? '' : 's'} failed: ${unnamed
			.map((item) => item.id)
			.join(', ')}. Fix them, or name them in allowFailed to build without them.`;
	if (build.problems.length)
		return `The build is not a valid pack: ${build.problems
			.map((problem) => `${problem.code} at ${problem.path}${problem.at ?? ''}`)
			.join('; ')}.`;
	return undefined;
}

/** Write a build into the committed form, replacing only this library's files. */
export async function writePack(
	config: LoadedConfig,
	build: PackBuildRun,
	allowFailed?: readonly string[]
): Promise<PackRun> {
	const directory = packDirectory(config);
	const why = refusal(build, allowFailed);
	if (why) throw new Error(`No pack was written. ${why}`);
	const before = answered(await committedFiles(directory, build.library), build);
	const written: string[] = [];
	for (const [path, text] of Object.entries(build.files)) {
		if (before.get(path) === text) continue;
		await mkdir(dirname(join(directory, path)), { recursive: true });
		await writeFile(join(directory, path), text);
		written.push(path);
	}
	const removed = [...before.keys()].filter((path) => !(path in build.files)).sort();
	for (const path of removed) await rm(join(directory, path));
	return { ...report(build, directory), written: written.sort(), removed };
}

/** Compare a build with the committed form, writing nothing. */
export async function checkCommitted(
	config: LoadedConfig,
	build: PackBuildRun,
	allowFailed?: readonly string[]
): Promise<PackCheckRun> {
	const directory = packDirectory(config);
	const before = answered(await committedFiles(directory, build.library), build);
	const changed = Object.keys(build.files)
		.filter((path) => before.has(path) && before.get(path) !== build.files[path])
		.sort();
	const added = Object.keys(build.files)
		.filter((path) => !before.has(path))
		.sort();
	const removed = [...before.keys()].filter((path) => !(path in build.files)).sort();
	return {
		...report(build, directory),
		valid:
			refusal(build, allowFailed) === undefined &&
			!changed.length &&
			!added.length &&
			!removed.length,
		changed,
		added,
		removed,
	};
}

type Named = { name: string } & Record<string, unknown>;

/**
 * What export can recheck with no browser: the facts the manifest declares and the statements the
 * guide files hold. The records are built again from those alone, with no case, and every field
 * that comes from them is compared. A plugin's schema source runs only in the page, so with
 * plugins configured a member the manifest does not declare, or a field it leaves out, is left to
 * the check in CI.
 */
function staleness(
	config: LoadedConfig,
	pack: PackConfig,
	committed: ReadonlyMap<string, string>
): string[] {
	const schemas = Object.values(config.schemas);
	const expected = buildPack({
		config: pack,
		schemas,
		...(config.guides ? { guides: config.guides } : {}),
		coverage: computeCoverage(schemas, []),
		cases: [],
		examples: [],
	});
	const plugins = config.plugins.length > 0;
	const refused: string[] = [];
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	const statements = (items: { id: string; text: string }[] | undefined) =>
		(items ?? []).map(({ id, text }) => [id, text]);
	const rulesOf = (record: PackComponent) => {
		const names = new Set(record.api.attributes.map((item) => item.name));
		return (config.guides?.rules ?? [])
			.filter(
				({ appliesTo }) =>
					appliesTo.tags?.includes(record.tag) ||
					appliesTo.attributes?.some((name) => names.has(name))
			)
			.map((rule) => rule.id)
			.sort();
	};
	for (const [path, text] of committed) {
		const why = (reason: string) => refused.push(`${path}: ${reason}`);
		if (path.startsWith('rules/')) {
			const want = JSON.parse(expected.files.get(path) ?? '{"rules":[]}') as PackRules;
			const strip = (rules: PackRules['rules']) =>
				rules.map(({ id, text, appliesTo }) => ({ id, text, appliesTo }));
			if (!same(strip((JSON.parse(text) as PackRules).rules), strip(want.rules)))
				why('Its rules differ from the guide files and guide sources.');
			continue;
		}
		const record = JSON.parse(text) as PackComponent;
		const built = expected.files.get(path);
		const guide = config.guides?.components.find((item) => item.tag === record.tag);
		const fields: [string, unknown, unknown][] = [
			['summary', record.summary, guide?.summary],
			['detail', record.detail, guide?.detail],
			['status', record.status, guide?.status ?? 'stable'],
			['replacedBy', record.replacedBy, guide?.replacedBy],
			['usage', statements(record.usage), statements(guide?.usage)],
			['a11y.statements', statements(record.a11y.statements), statements(guide?.a11y)],
			['rules', record.rules, rulesOf(record)],
		];
		for (const [field, have, want] of fields)
			if (!same(have, want)) why(`Its ${field} differs from its guide.`);
		const observedStates = new Set(
			record.a11y.role.filter((role) => role.basis === 'observed').map((role) => role.state)
		);
		const authored = (guide?.roles ?? [])
			.filter((role) => !observedStates.has(role.state))
			.map(({ state, role, name }) => ({ state, role, ...(name ? { name } : {}) }))
			.sort((a, b) => (a.state < b.state ? -1 : 1));
		const recordAuthored = record.a11y.role
			.filter((role) => role.basis === 'authored')
			.map(({ state, role, name }) => ({ state, role, ...(name ? { name } : {}) }));
		if (!same(recordAuthored, authored)) why('Its authored roles differ from its guide.');
		if (!built) {
			if (!plugins) why('The manifest no longer describes it.');
			continue;
		}
		const want = JSON.parse(built) as PackComponent;
		if (!same(record.import ?? null, want.import ?? null))
			why('Its import differs from the manifest.');
		const sections = [
			['attributes', ['property', 'type', 'description', 'default', 'values', 'rules']],
			['slots', ['description']],
			['events', ['description', 'detail']],
			['cssProperties', ['description', 'default']],
		] as const;
		for (const [section, keys] of sections) {
			const have = record.api[section] as unknown as Named[];
			const declared = want.api[section] as unknown as Named[];
			for (const item of declared) {
				const found = have.find((entry) => entry.name === item.name);
				const label = `api.${section}.${item.name || '(default)'}`;
				if (!found) {
					why(`The manifest declares ${label}, which it does not name.`);
					continue;
				}
				for (const key of keys) {
					// A value's basis is observed; only the values themselves come from the manifest.
					const value = (entry: Named) =>
						key === 'values'
							? (entry.values as { value: unknown }[] | undefined)?.map((item) => item.value)
							: entry[key];
					const declaredValue = value(item);
					if (declaredValue === undefined && plugins) continue;
					if (!same(value(found), declaredValue))
						why(`Its ${label}.${key} differs from the manifest.`);
				}
			}
			if (!plugins)
				for (const item of have)
					if (!declared.some((entry) => entry.name === item.name))
						why(
							`It names api.${section}.${item.name || '(default)'}, which the manifest no longer declares.`
						);
		}
	}
	for (const path of expected.files.keys())
		if (!committed.has(path))
			refused.push(`${path}: The manifest declares it, and it has no record.`);
	return refused;
}

/**
 * Write the exported form: the committed records and rules, and a catalog stamped with the
 * package. Other libraries already in the target stay. The new pack is written beside the target
 * and swapped in, carrying the deployment's `pack.toml` across.
 */
export async function exportPack(
	config: LoadedConfig,
	request: PackExportRequest
): Promise<PackExportRun> {
	const pack = packConfig(config);
	const source = packDirectory(config);
	const committed = await committedFiles(source, pack.library);
	if (!committed.size)
		throw new Error(
			`No committed records for ${pack.library} in ${source}. Build them with specimen pack.`
		);
	const encoder = new TextEncoder();
	const files = new Map([...committed].map(([path, text]) => [path, encoder.encode(text)]));
	const check = checkPack(files, { form: 'committed' });
	if (!check.valid)
		throw new Error(
			`The committed records are not a valid pack: ${check.problems
				.map((problem) => `${problem.code} at ${problem.path}${problem.at ?? ''}`)
				.join('; ')}.`
		);
	const refused = staleness(config, pack, committed);
	if (refused.length)
		throw new Error(
			`The committed records are out of date; build them again with specimen pack. ${refused.join(' ')}`
		);

	const manifestPath = resolve(dirname(config.file), pack.package);
	const identity = JSON.parse(await readFile(manifestPath, 'utf8')) as {
		name?: unknown;
		version?: unknown;
	};
	if (typeof identity.name !== 'string' || typeof identity.version !== 'string')
		throw new Error(`${pack.package} has no package name and version to stamp.`);
	const catalog = packCatalog(files, pack.library, {
		title: pack.title,
		package: { name: identity.name, version: identity.version },
		prefix: pack.prefix,
		...(request.revision ? { revision: request.revision } : {}),
	});

	const target = resolve(dirname(config.file), request.directory);
	const parent = dirname(target);
	await mkdir(parent, { recursive: true });
	const staging = join(parent, `.${basename(target)}.specimen-export`);
	const retired = join(parent, `.${basename(target)}.specimen-retired`);
	// An export stopped between its two renames left the old pack beside the target: put it back.
	if (!existsSync(target) && existsSync(retired)) await rename(retired, target);
	if (existsSync(target)) {
		const unexpected = (await readdir(target)).filter((name) => !PACK_ENTRIES.has(name));
		if (unexpected.length)
			throw new Error(
				`${request.directory} holds ${unexpected.join(', ')}, which a pack does not. Export into a pack's root: a directory holding only data/, rules/ and pack.toml, or a new one.`
			);
		// The swap carries regular files across; anything else would be lost with the old directory.
		const other = (await readdir(target, { recursive: true, withFileTypes: true })).filter(
			(entry) => !entry.isFile() && !entry.isDirectory()
		);
		if (other.length)
			throw new Error(
				`${request.directory} holds ${other.map((entry) => entry.name).join(', ')}, which is not a regular file; export copies only regular files across, so move it first.`
			);
	}
	await rm(staging, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });
	let keptPackToml = false;
	if (existsSync(target)) {
		// The other libraries stay as they stand, and so does the deployment's own file. A target
		// that cannot be read is an error: swapping it would lose what was not read.
		const existing = await readPackFiles(target);
		for (const [path, bytes] of existing) {
			if (
				path === 'pack.toml' ||
				path === `rules/${pack.library}.json` ||
				path.startsWith(`data/${pack.library}/`)
			)
				continue;
			await mkdir(dirname(join(staging, path)), { recursive: true });
			await writeFile(join(staging, path), bytes);
		}
		if (existsSync(join(target, 'pack.toml'))) {
			await cp(join(target, 'pack.toml'), join(staging, 'pack.toml'));
			keptPackToml = true;
		}
	}
	const written = [...committed.keys(), `data/${pack.library}/library.json`].sort();
	for (const [path, text] of [
		...committed,
		[`data/${pack.library}/library.json`, catalog] as const,
	]) {
		await mkdir(dirname(join(staging, path)), { recursive: true });
		await writeFile(join(staging, path), text);
	}
	// Only this library's files are export's to answer for; the others are kept as they stand.
	const own = (path: string) =>
		path === `rules/${pack.library}.json` || path.startsWith(`data/${pack.library}/`);
	const exported = new Map([...(await readPackFiles(staging))].filter(([path]) => own(path)));
	const problems = checkPack(exported, { form: 'exported' }).problems;
	if (problems.length) {
		await rm(staging, { recursive: true, force: true });
		throw new Error(
			`The exported pack is not valid: ${problems.map((problem) => `${problem.code} at ${problem.path}`).join('; ')}.`
		);
	}
	await rm(retired, { recursive: true, force: true });
	if (existsSync(target)) await rename(target, retired);
	await rename(staging, target);
	await rm(retired, { recursive: true, force: true });
	return {
		library: pack.library,
		directory: target,
		digest: packContentDigest(files, pack.library),
		files: written,
		keptPackToml,
	};
}
