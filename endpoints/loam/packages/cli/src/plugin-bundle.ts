/**
 * @fileoverview `loam plugin check` and `loam plugin pack` (phase 5's no-terminal amendment, 4.1, 4.4 and 10): a
 * plugin's source (`loam-plugin.toml` beside its packed apps and engine artifacts), a packed folder
 * (`plugin-manifest.json`) or a `.loam-plugin` archive, read into memory as regular files only and checked by the rules
 * `loam-desktop`'s inspect holds over staged bytes. Nothing in a bundle runs here.
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	bundlePathProblem,
	PLUGIN_BUNDLE_LIMITS_V1,
	PLUGIN_MANIFEST_FILE,
	PLUGIN_SOURCE_FILE,
	type PluginBundleLimitsV1,
	type PluginManifestV1,
	type PluginTargetV1,
	readPluginManifest,
} from '@lushly-dev/loam-manifest/plugin';
import { type Finding, parseManifestToml } from './check.js';
import { isWithin, OUTPUT_MARKER, realish } from './tree.js';
import { readZip, writeZip } from './zip.js';

/** The bounds a bundle is held to: 4.4's, which a test may lower. */
export type PluginBundleLimits = PluginBundleLimitsV1;

/** A source to pack, a packed folder, or a `.loam-plugin` archive. */
export type PluginBundleKind = 'source' | 'folder' | 'archive';

export const PLUGIN_ARCHIVE_EXTENSION = '.loam-plugin';

export interface PluginBundleSummary {
	plugin: { id: string; title: string; version: string };
	apps: Array<{ id: string; kind: string; title: string }>;
	engine?: {
		id: string;
		auth: string;
		approvals: string;
		labels: string;
		artifacts: Array<{ target: PluginTargetV1; path: string; sha256: string }>;
	};
	/** The files the bundle holds (or, for a source, would hold once packed) and their bytes. */
	files: number;
	bytes: number;
}

export type PluginCheckReport =
	| ({ ok: true; kind: PluginBundleKind; manifest: PluginManifestV1 } & PluginBundleSummary)
	| { ok: false; kind?: PluginBundleKind; refusals: Finding[] };

/** What a bundle holds, by its path inside the bundle. */
type Files = Map<string, Buffer>;

const refuse = (code: string, key: string, message: string, suggestion: string): Finding => ({
	code,
	key,
	message,
	suggestion,
});

const fail = (kind: PluginBundleKind | undefined, ...refusals: Finding[]): PluginCheckReport =>
	kind === undefined ? { ok: false, refusals } : { ok: false, kind, refusals };

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const tooLarge = (key: string, message: string): Finding =>
	refuse(
		'PLUGIN_BUNDLE_TOO_LARGE',
		key,
		message,
		'Keep the plugin bundle under 256 MiB and 2,000 files, and `plugin-manifest.json` under 1 MiB.'
	);

const escaped = (key: string, message: string): Finding =>
	refuse(
		'PLUGIN_PATH_ESCAPE',
		key,
		message,
		'Remove symbolic links, special files, duplicate or colliding paths, and paths outside the plugin root, then repack.'
	);

/** Collects a bundle's files under its bounds, refusing a bad path, a second copy or a case collision. */
class Collector {
	readonly files: Files = new Map();
	readonly refusals: Finding[] = [];
	private readonly folded = new Map<string, string>();
	private bytes = 0;

	constructor(private readonly limits: PluginBundleLimits) {}

	/** Whether there is room for one more file of `size` bytes; refuses once when there is not. */
	room(path: string, size: number): boolean {
		if (this.files.size + 1 > this.limits.files) {
			this.refusals.push(tooLarge(path, `The bundle holds more than ${this.limits.files} files.`));
			return false;
		}
		if (this.bytes + size > this.limits.totalBytes) {
			this.refusals.push(
				tooLarge(path, `The bundle's files come to more than ${this.limits.totalBytes} bytes.`)
			);
			return false;
		}
		return true;
	}

	add(path: string, data: Buffer): boolean {
		const problem = bundlePathProblem(path);
		if (problem) {
			this.refusals.push(escaped(path, `The path is refused: ${problem}.`));
			return false;
		}
		if (this.files.has(path)) {
			this.refusals.push(escaped(path, 'The bundle holds this path twice.'));
			return false;
		}
		const fold = path.toLowerCase();
		const other = this.folded.get(fold);
		if (other !== undefined) {
			this.refusals.push(
				escaped(
					path,
					`It and \`${other}\` differ only in case, so one would replace the other on macOS and Windows.`
				)
			);
			return false;
		}
		// A file named as another's directory collides however a system folds case.
		const segments = fold.split('/');
		for (let end = 1; end < segments.length; end++) {
			const parent = this.folded.get(segments.slice(0, end).join('/'));
			if (parent !== undefined) {
				this.refusals.push(escaped(path, `\`${parent}\` is a file, and this path is inside it.`));
				return false;
			}
		}
		for (const held of this.folded.keys()) {
			if (held.startsWith(`${fold}/`)) {
				this.refusals.push(escaped(path, 'Another file in the bundle is inside this path.'));
				return false;
			}
		}
		if (!this.room(path, data.length)) return false;
		this.files.set(path, data);
		this.folded.set(fold, path);
		this.bytes += data.length;
		return true;
	}

	get size(): number {
		return this.bytes;
	}
}

/**
 * The regular files below `directory`, as `prefix/<relative path>`; a link, a FIFO, a socket or a device is refused
 * rather than followed or read (4.4, item 3). `skipMarker` leaves out the mark `loam app pack` leaves at a package's
 * root, which is no part of the package.
 */
async function walk(
	directory: string,
	prefix: string,
	collector: Collector,
	skipMarker: boolean
): Promise<void> {
	for (const name of (await readdir(directory)).sort()) {
		if (skipMarker && name === OUTPUT_MARKER) continue;
		const full = join(directory, name);
		const path = prefix === '' ? name : `${prefix}/${name}`;
		const info = await lstat(full);
		if (info.isSymbolicLink()) {
			collector.refusals.push(
				escaped(path, 'It is a symbolic link, which a plugin bundle never holds.')
			);
		} else if (info.isDirectory()) {
			await walk(full, path, collector, false);
		} else if (info.isFile()) {
			if (collector.room(path, info.size)) collector.add(path, await readFile(full));
		} else {
			collector.refusals.push(
				escaped(
					path,
					'It is not a regular file: a FIFO, socket or device is never part of a bundle.'
				)
			);
		}
		if (collector.refusals.some(({ code }) => code === 'PLUGIN_BUNDLE_TOO_LARGE')) return;
	}
}

/** Refuses a path whose any component below `root` is a link, so nothing it names is outside the plugin root. */
async function linkFree(
	root: string,
	path: string,
	key: string
): Promise<Finding | 'missing' | undefined> {
	let at = root;
	for (const segment of path.split('/')) {
		at = join(at, segment);
		try {
			if ((await lstat(at)).isSymbolicLink())
				return escaped(
					key,
					`\`${path}\` passes through a symbolic link, which a plugin bundle never holds.`
				);
		} catch {
			return 'missing';
		}
	}
	return undefined;
}

/** A source's files by their place in the source: its packed apps and its artifacts, nothing else of the folder. */
async function sourceFiles(
	root: string,
	manifest: PluginManifestV1,
	collector: Collector
): Promise<void> {
	for (const [index, app] of manifest.apps.entries()) {
		const key = `apps[${index}].path`;
		const linked = await linkFree(root, app.path, key);
		if (
			linked === 'missing' ||
			(linked === undefined && !(await lstat(join(root, app.path))).isDirectory())
		) {
			collector.refusals.push(
				refuse(
					'PLUGIN_MANIFEST_INVALID',
					key,
					`\`${app.path}\` is not a directory in the plugin's source.`,
					'Run `loam app pack` for the app, and point `path` at the package it writes.'
				)
			);
		} else if (linked) collector.refusals.push(linked);
		else await walk(join(root, app.path), app.path, collector, true);
	}
	for (const [target, artifact] of Object.entries(manifest.engine?.artifacts ?? {})) {
		const key = `engine.artifacts["${target}"].path`;
		const linked = await linkFree(root, artifact.path, key);
		if (linked === 'missing') continue;
		if (linked) {
			collector.refusals.push(linked);
			continue;
		}
		const full = join(root, artifact.path);
		const info = await lstat(full);
		if (!info.isFile()) {
			collector.refusals.push(escaped(key, `\`${artifact.path}\` is not a regular file.`));
		} else if (collector.room(artifact.path, info.size)) {
			collector.add(artifact.path, await readFile(full));
		}
	}
}

/** The checks over a bundle's files once its manifest is safe to follow: the apps, and each artifact's digest. */
function contentRefusals(
	json: unknown,
	files: Files
): { refusals: Finding[]; report?: PluginBundleSummary & { manifest: PluginManifestV1 } } {
	const first = readPluginManifest(json);
	if (!first.ok) return { refusals: first.refusals };
	const apps: Record<string, unknown> = {};
	const refusals: Finding[] = [];
	for (const [index, app] of first.manifest.apps.entries()) {
		const data = files.get(`${app.path}/app-manifest.json`);
		if (data === undefined) continue;
		try {
			apps[app.id] = JSON.parse(data.toString('utf8'));
		} catch {
			refusals.push(
				refuse(
					'PLUGIN_MANIFEST_INVALID',
					`apps[${index}].path`,
					`\`${app.path}/app-manifest.json\` is not JSON.`,
					'Run `loam app pack` for the app again.'
				)
			);
		}
	}
	if (refusals.length > 0) return { refusals };
	const read = readPluginManifest(json, apps);
	if (!read.ok) return { refusals: read.refusals };
	const { manifest } = read;
	const engine = manifest.engine;
	for (const [target, artifact] of Object.entries(engine?.artifacts ?? {})) {
		const key = `engine.artifacts["${target}"]`;
		const data = files.get(artifact.path);
		if (data === undefined) {
			refusals.push(
				refuse(
					'PLUGIN_MANIFEST_INVALID',
					`${key}.path`,
					`\`${artifact.path}\` is not in the bundle.`,
					`Build the engine for \`${target}\` to \`${artifact.path}\`, or remove the target.`
				)
			);
			continue;
		}
		const digest = sha256(data);
		if (digest !== artifact.sha256) {
			refusals.push(
				refuse(
					'PLUGIN_HASH_MISMATCH',
					`${key}.sha256`,
					`\`${artifact.path}\`'s SHA-256 is \`${digest}\`, not the \`${artifact.sha256}\` the manifest pins.`,
					`If this is the build you mean to ship, set \`sha256 = "${digest}"\`; otherwise rebuild it.`
				)
			);
		}
	}
	if (refusals.length > 0) return { refusals };
	let bytes = 0;
	for (const data of files.values()) bytes += data.length;
	return {
		refusals: [],
		report: {
			manifest,
			plugin: {
				id: manifest.plugin.id,
				title: manifest.plugin.title,
				version: manifest.plugin.version,
			},
			apps: manifest.apps.map(({ id }) => {
				const { plugin } = read.apps[id] as { plugin: { kind: string; title: string } };
				return { id, kind: plugin.kind, title: plugin.title };
			}),
			...(engine
				? {
						engine: {
							id: engine.id,
							auth: engine.auth.mode,
							approvals: engine.mount.approvals ?? 'none',
							labels: engine.mount.labels ?? 'whole',
							artifacts: Object.entries(engine.artifacts).map(
								([target, { path, sha256: pinned }]) => ({
									target: target as PluginTargetV1,
									path,
									sha256: pinned,
								})
							),
						},
					}
				: {}),
			files: files.size,
			bytes,
		},
	};
}

/** Parses a bundle's manifest file under its bound. */
function manifestOf(
	data: Buffer | undefined,
	file: string,
	limits: PluginBundleLimits
): { json: unknown } | { refusal: Finding } {
	if (data === undefined) {
		return {
			refusal: refuse(
				'PLUGIN_MANIFEST_INVALID',
				file,
				`There is no \`${file}\` at the bundle's root.`,
				'Check a plugin source holding `loam-plugin.toml`, or a bundle `loam plugin pack` wrote.'
			),
		};
	}
	if (data.length > limits.manifestBytes)
		return { refusal: tooLarge(file, `\`${file}\` is over ${limits.manifestBytes} bytes.`) };
	try {
		const text = data.toString('utf8');
		return { json: file === PLUGIN_SOURCE_FILE ? parseManifestToml(text) : JSON.parse(text) };
	} catch {
		return {
			refusal: refuse(
				'PLUGIN_MANIFEST_INVALID',
				file,
				`\`${file}\` is not valid ${file === PLUGIN_SOURCE_FILE ? 'TOML' : 'JSON'}.`,
				file === PLUGIN_SOURCE_FILE
					? 'Fix the TOML.'
					: 'Pack the plugin again with `loam plugin pack`.'
			),
		};
	}
}

/** A packed bundle's files, held to every rule: what `check` reports and what `pack` writes. */
function checkPacked(
	kind: PluginBundleKind,
	collector: Collector,
	limits: PluginBundleLimits
): PluginCheckReport {
	if (collector.refusals.length > 0) return fail(kind, ...collector.refusals);
	const read = manifestOf(collector.files.get(PLUGIN_MANIFEST_FILE), PLUGIN_MANIFEST_FILE, limits);
	if ('refusal' in read) return fail(kind, read.refusal);
	const { refusals, report } = contentRefusals(read.json, collector.files);
	return report ? { ok: true, kind, ...report } : fail(kind, ...refusals);
}

async function readArchive(path: string, limits: PluginBundleLimits): Promise<PluginCheckReport> {
	const info = await lstat(path);
	// Deflate can grow incompressible data a little, never by a mebibyte over the cap.
	if (info.size > limits.totalBytes + 1024 * 1024)
		return fail('archive', tooLarge('(archive)', 'The archive is larger than a bundle may be.'));
	const zip = readZip(await readFile(path), limits.totalBytes, limits.files);
	if (!zip.ok) {
		return fail(
			'archive',
			zip.problem === 'too-large'
				? tooLarge('(archive)', `The archive is too large: ${zip.detail}.`)
				: refuse(
						'PLUGIN_MANIFEST_INVALID',
						'(archive)',
						`The file is not a \`.loam-plugin\` archive Loam reads: ${zip.detail}.`,
						'Pack the plugin again with `loam plugin pack <dir> --out <name>.loam-plugin`.'
					)
		);
	}
	const collector = new Collector(limits);
	for (const entry of zip.entries) {
		if (entry.symlink) {
			collector.refusals.push(
				escaped(entry.path, 'It is a symbolic link, which a plugin bundle never holds.')
			);
		} else if (entry.directory) {
			const problem = bundlePathProblem(entry.path.replace(/\/$/, ''));
			if (problem) collector.refusals.push(escaped(entry.path, `The path is refused: ${problem}.`));
		} else collector.add(entry.path, entry.data);
	}
	return checkPacked('archive', collector, limits);
}

/** `loam plugin check <dir|bundle>`: every rule a bundle is held to, with nothing written and nothing run. */
export async function checkPluginBundle(
	path: string,
	limits: PluginBundleLimits = PLUGIN_BUNDLE_LIMITS_V1
): Promise<PluginCheckReport> {
	const root = resolve(path);
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(root);
	} catch {
		return fail(
			undefined,
			refuse(
				'PLUGIN_MANIFEST_INVALID',
				'(bundle)',
				`There is nothing at \`${path}\`.`,
				'Name a plugin source, a packed plugin folder or a `.loam-plugin` archive.'
			)
		);
	}
	if (info.isSymbolicLink())
		return fail(undefined, escaped('(bundle)', 'The bundle itself is a symbolic link.'));
	if (info.isFile()) {
		if (!root.endsWith(PLUGIN_ARCHIVE_EXTENSION)) {
			return fail(
				undefined,
				refuse(
					'PLUGIN_MANIFEST_INVALID',
					'(bundle)',
					'A file is read as a plugin bundle only when it is a `.loam-plugin` archive.',
					'Name the plugin source folder, or the `.loam-plugin` archive `loam plugin pack` wrote.'
				)
			);
		}
		return readArchive(root, limits);
	}
	const names = await readdir(root);
	if (names.includes(PLUGIN_MANIFEST_FILE)) {
		const collector = new Collector(limits);
		await walk(root, '', collector, false);
		return checkPacked('folder', collector, limits);
	}
	return checkSource(root, limits);
}

/** A source: its manifest's rules first, then only what it lists, read as `pack` would bundle it. */
async function checkSource(root: string, limits: PluginBundleLimits): Promise<PluginCheckReport> {
	const source = join(root, PLUGIN_SOURCE_FILE);
	let data: Buffer | undefined;
	try {
		const info = await lstat(source);
		if (info.isSymbolicLink() || !info.isFile())
			return fail('source', escaped(PLUGIN_SOURCE_FILE, 'It is not a regular file.'));
		data = await readFile(source);
	} catch {
		data = undefined;
	}
	const read = manifestOf(data, PLUGIN_SOURCE_FILE, limits);
	if ('refusal' in read) return fail('source', read.refusal);
	const first = readPluginManifest(read.json);
	if (!first.ok) return fail('source', ...first.refusals);
	const collector = new Collector(limits);
	await sourceFiles(root, first.manifest, collector);
	if (collector.refusals.length > 0) return fail('source', ...collector.refusals);
	const { refusals, report } = contentRefusals(read.json, collector.files);
	if (!report) return fail('source', ...refusals);
	// What the source would pack into: held to the packed bundle's rules and bounds as well.
	const packed = packedFiles(report.manifest, collector.files, limits);
	if (!packed.ok) return fail('source', ...packed.refusals);
	return {
		ok: true,
		kind: 'source',
		...report,
		files: packed.files.size,
		bytes: packed.collector.size,
	};
}

/** The packed layout (4.1): `plugin-manifest.json`, each app under `apps/<id>/`, each artifact where it is named. */
function packedFiles(
	manifest: PluginManifestV1,
	sources: Files,
	limits: PluginBundleLimits
):
	| { ok: true; files: Files; manifest: PluginManifestV1; collector: Collector }
	| { ok: false; refusals: Finding[] } {
	const packed: PluginManifestV1 = {
		...manifest,
		apps: manifest.apps.map(({ id }) => ({ id, path: `apps/${id}` })) as PluginManifestV1['apps'],
	};
	const text = Buffer.from(`${JSON.stringify(packed, null, '\t')}\n`);
	const collector = new Collector(limits);
	collector.add(PLUGIN_MANIFEST_FILE, text);
	for (const app of manifest.apps) {
		for (const [path, data] of sources) {
			if (path.startsWith(`${app.path}/`))
				collector.add(`apps/${app.id}/${path.slice(app.path.length + 1)}`, data);
		}
	}
	for (const artifact of Object.values(manifest.engine?.artifacts ?? {})) {
		const data = sources.get(artifact.path);
		if (data) collector.add(artifact.path, data);
	}
	const report = checkPacked('folder', collector, limits);
	return report.ok
		? { ok: true, files: collector.files, manifest: packed, collector }
		: { ok: false, refusals: report.refusals };
}

export interface PackPluginOptions {
	/** The plugin's source, holding `loam-plugin.toml`. Default: the working directory. */
	dir?: string;
	/** A `.loam-plugin` archive to write, or a directory that is absent or empty. */
	out: string;
	limits?: PluginBundleLimits;
}

export type PackPluginResult =
	| ({ ok: true; out: string; kind: 'folder' | 'archive'; written: string[] } & PluginBundleSummary)
	| { ok: false; refusals: Finding[] };

const outRefusal = (message: string, suggestion: string): Finding =>
	refuse('PLUGIN_PACK_OUT_INVALID', '--out', message, suggestion);

/** `loam plugin pack <dir> --out <bundle>`: check the source, then write the packed bundle it checks as. */
export async function packPlugin(options: PackPluginOptions): Promise<PackPluginResult> {
	const limits = options.limits ?? PLUGIN_BUNDLE_LIMITS_V1;
	const root = await realish(options.dir ?? '.');
	const out = await realish(resolve(options.out));
	const report = await checkPluginBundle(root, limits);
	if (!report.ok) return { ok: false, refusals: report.refusals };
	if (report.kind !== 'source') {
		return {
			ok: false,
			refusals: [
				refuse(
					'PLUGIN_MANIFEST_INVALID',
					'(bundle)',
					'This is a packed bundle already; `loam plugin pack` packs a source holding `loam-plugin.toml`.',
					'Run `loam plugin check` on it instead, or pack its source.'
				),
			],
		};
	}
	const { manifest } = report;
	const listed = [
		...manifest.apps.map(({ path }) => join(root, path)),
		...Object.values(manifest.engine?.artifacts ?? {}).map(({ path }) => join(root, path)),
	];
	if (listed.some((path) => isWithin(out, path) || isWithin(path, out))) {
		return {
			ok: false,
			refusals: [
				outRefusal(
					'`--out` is inside what is packed, or holds it.',
					'Write the bundle outside the apps and engines it packs, such as `dist/<id>.loam-plugin`.'
				),
			],
		};
	}
	const archive = out.endsWith(PLUGIN_ARCHIVE_EXTENSION);
	let existing: Awaited<ReturnType<typeof lstat>> | undefined;
	try {
		existing = await lstat(out);
	} catch {
		existing = undefined;
	}
	if (
		existing &&
		(archive ? !existing.isFile() : !existing.isDirectory() || (await readdir(out)).length > 0)
	) {
		return {
			ok: false,
			refusals: [
				outRefusal(
					archive
						? '`--out` exists and is not a file to replace.'
						: '`--out` exists and is not an empty directory.',
					'Choose a new `.loam-plugin` file, or an empty or absent directory.'
				),
			],
		};
	}
	// Collected again, now from disk, so what is written is what was checked.
	const collector = new Collector(limits);
	await sourceFiles(root, manifest, collector);
	const packed = packedFiles(manifest, collector.files, limits);
	if (collector.refusals.length > 0 || !packed.ok)
		return { ok: false, refusals: [...collector.refusals, ...(packed.ok ? [] : packed.refusals)] };
	const engines = new Set(Object.values(manifest.engine?.artifacts ?? {}).map(({ path }) => path));
	const written = [...packed.files.keys()].sort();
	if (archive) {
		await mkdir(resolve(out, '..'), { recursive: true });
		await writeFile(
			out,
			writeZip(
				written.map((path) => ({
					path,
					data: packed.files.get(path) as Buffer,
					executable: engines.has(path),
				}))
			)
		);
	} else {
		for (const path of written) {
			const target = join(out, ...path.split('/'));
			await mkdir(resolve(target, '..'), { recursive: true });
			await writeFile(target, packed.files.get(path) as Buffer, {
				mode: engines.has(path) ? 0o755 : 0o644,
			});
		}
	}
	const { ok: _ok, kind: _kind, manifest: _manifest, ...summary } = report;
	return {
		ok: true,
		out,
		kind: archive ? 'archive' : 'folder',
		written,
		...summary,
		files: written.length,
		bytes: packed.collector.size,
	};
}
