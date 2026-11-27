/**
 * @fileoverview `loam plugin check`: a plugin's source (`loam-plugin.toml`) or a packed directory bundle
 * (`plugin-manifest.json`), checked under the phase 5 no-terminal amendment's 4.4 with nothing of it run. The
 * manifest's own rules are `@lushly-dev/loam-manifest/plugin`'s; this adds what needs the disk: each app's packed
 * manifest, regular files only, each engine's SHA-256, the bundle's bounds and its digest (7.1). A `.loam-plugin`
 * archive (step 9a2) is read by `plugin-archive.ts`, which stages its files and checks them here as a bundle.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import {
	bundlePathProblem,
	foldBundlePath,
	PLUGIN_TARGETS_V1,
	type PluginManifestV1,
	pluginAppsRefusals,
	readPluginManifest,
} from '@lushly-dev/loam-manifest/plugin';
import { readManifest } from '@lushly-dev/loam-manifest/validate';
import { parse as parseToml } from 'smol-toml';
import type { Finding } from './check.js';
import { builtPaths } from './file-rules.js';
import { checkPluginArchive, PLUGIN_ARCHIVE_EXTENSION } from './plugin-archive.js';
import { OUTPUT_MARKER } from './tree.js';

export const PLUGIN_SOURCE = 'loam-plugin.toml';
export const PLUGIN_MANIFEST = 'plugin-manifest.json';

/** 4.4, rule 3's bounds, which the desktop's inspect holds too. */
export const PLUGIN_BUNDLE_LIMITS = Object.freeze({
	bytes: 256 * 1024 * 1024,
	files: 2_000,
	manifestBytes: 1024 * 1024,
});

/** One file of a bundle: its path in the bundle, where it is now, and its bytes' SHA-256. */
export interface BundleFile {
	path: string;
	source: string;
	size: number;
	sha256: string;
}

export interface PluginCheckReport {
	ok: boolean;
	refusals: Finding[];
	/** `loam-plugin.toml` for a source, `plugin-manifest.json` for a packed bundle, a `.loam-plugin` file for an archive. */
	form?: 'source' | 'bundle' | 'archive';
	manifest?: PluginManifestV1;
	/**
	 * Every file the bundle holds but its manifest, sorted by path; only when nothing was refused. An archive's `source`
	 * is `<archive>!<path>`, since the files it was checked as are gone once the check returns.
	 */
	files?: BundleFile[];
	/** 7.1's digest of the bundle as it is (a bundle) or as `plugin pack` writes it (a source). */
	bundleSha256?: string;
	/** Each engine artifact, by target. */
	engines?: Array<{ target: string; path: string; sha256: string }>;
}

/** The manifest's bytes in a packed bundle: tab-indented JSON and a newline, as `plugin pack` writes it. */
export const packedManifestText = (manifest: PluginManifestV1): string =>
	`${JSON.stringify(manifest, null, '\t')}\n`;

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

function fileSha256(path: string): Promise<string> {
	return new Promise((done, fail) => {
		const hash = createHash('sha256');
		createReadStream(path)
			.on('data', (chunk) => hash.update(chunk))
			.on('error', fail)
			.on('end', () => done(hash.digest('hex')));
	});
}

/**
 * A bundle's digest (the amendment's 7.1, step 4): the SHA-256 of one line per file, `plugin-manifest.json` among
 * them, sorted by the path's UTF-8 bytes, each line the file's SHA-256 in lowercase hex, two spaces, its path and a
 * line feed, as `sha256sum` prints them. A path holds no control character (4.4, rule 3), so no line feed.
 */
export function bundleDigest(files: ReadonlyArray<{ path: string; sha256: string }>): string {
	const lines = [...files]
		.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
		.map(({ path, sha256: digest }) => `${digest}  ${path}\n`);
	return sha256(lines.join(''));
}

const finding = (code: string, key: string, message: string, suggestion: string): Finding => ({
	code,
	key,
	message,
	suggestion,
});

/** A refusal of a path's place on disk: a link, or not a regular file or directory. */
const placeRefusal = (key: string, message: string): Finding =>
	finding(
		'PLUGIN_PATH_ESCAPE',
		key,
		message,
		'A bundle holds regular files and directories only: remove symbolic links, devices and sockets, then pack again.'
	);

/** Each segment of `path` below `root` exists and is a directory but the last, which is `last`; no link on the way. */
async function placeProblem(
	root: string,
	path: string,
	last: 'file' | 'directory'
): Promise<string | undefined> {
	const segments = path.split('/');
	for (let index = 0; index < segments.length; index++) {
		const at = join(root, ...segments.slice(0, index + 1));
		const stats = await lstat(at).catch(() => undefined);
		if (!stats) return 'does not exist';
		if (stats.isSymbolicLink()) return 'is or passes through a symbolic link';
		const want = index === segments.length - 1 ? last : 'directory';
		if (want === 'directory' ? !stats.isDirectory() : !stats.isFile())
			return want === 'file' ? 'is not a regular file' : 'is not a directory';
	}
	return undefined;
}

/**
 * 4.4's bounds as a running count, so a tree past them stops being listed, read or hashed as soon as it is past them,
 * rather than once all of it has been.
 */
class Budget {
	files = 0;
	bytes = 0;
	exceeded = false;

	/** Seeded with the manifest when it is not among the files listed. */
	constructor(manifestBytes?: number) {
		if (manifestBytes !== undefined) this.take(manifestBytes);
	}

	/** Counts one file of `size` bytes; false once the bundle is past a bound. */
	take(size: number): boolean {
		this.files += 1;
		this.bytes += size;
		if (this.files > PLUGIN_BUNDLE_LIMITS.files || this.bytes > PLUGIN_BUNDLE_LIMITS.bytes)
			this.exceeded = true;
		return !this.exceeded;
	}
}

type Listed = { path: string; source: string; size: number };

/** Every file below `prefix`, as bundle paths; links, devices and bad names refused; it stops past the budget. */
async function listFiles(
	root: string,
	prefix: string,
	key: string,
	refusals: Finding[],
	budget?: Budget
): Promise<Listed[]> {
	const found: Listed[] = [];
	const entries = await readdir(join(root, ...prefix.split('/')), { withFileTypes: true });
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		if (budget?.exceeded) break;
		const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
		const source = join(root, ...path.split('/'));
		const problem = bundlePathProblem(path);
		if (problem) {
			refusals.push(placeRefusal(key, `\`${path}\` ${problem}.`));
			continue;
		}
		if (entry.isSymbolicLink()) refusals.push(placeRefusal(key, `\`${path}\` is a symbolic link.`));
		else if (entry.isDirectory())
			found.push(...(await listFiles(root, path, key, refusals, budget)));
		else if (entry.isFile()) {
			const { size } = await lstat(source);
			found.push({ path, source, size });
			budget?.take(size);
		} else refusals.push(placeRefusal(key, `\`${path}\` is not a regular file.`));
	}
	return found;
}

/** A manifest file's exact bytes, which the digest hashes, and their text, decoded strictly as UTF-8. */
interface ManifestFile {
	form: 'source' | 'bundle';
	file: string;
	bytes: Buffer;
	text: string;
}

/** Strict, and keeping a byte-order mark, which JSON then refuses, as a Rust reader does. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The manifest's file and its text, or why there is none. */
async function manifestSource(
	root: string
): Promise<{ ok: true; found: ManifestFile } | { ok: false; refusal: Finding }> {
	const no = (refusal: Finding) => ({ ok: false as const, refusal });
	const missing = (message: string) =>
		no(
			finding(
				'PLUGIN_MANIFEST_MISSING',
				root,
				message,
				`Give the plugin's source, which holds \`${PLUGIN_SOURCE}\`, or a bundle \`loam plugin pack\` wrote, which holds \`${PLUGIN_MANIFEST}\`.`
			)
		);
	const stats = await lstat(root).catch(() => undefined);
	if (!stats) return missing('The directory does not exist.');
	if (!stats.isDirectory())
		return missing(
			`It is not a directory or a \`${PLUGIN_ARCHIVE_EXTENSION}\` archive: \`loam plugin check\` reads a source, a directory bundle or an archive \`loam plugin pack\` wrote.`
		);
	const source = existsSync(join(root, PLUGIN_SOURCE));
	const bundle = existsSync(join(root, PLUGIN_MANIFEST));
	if (source && bundle) {
		return no(
			finding(
				'PLUGIN_MANIFEST_INVALID',
				PLUGIN_MANIFEST,
				`The directory holds both \`${PLUGIN_SOURCE}\` and \`${PLUGIN_MANIFEST}\`, so it is neither a source nor a bundle.`,
				`Keep \`${PLUGIN_SOURCE}\` in the source and pack it with \`loam plugin pack <dir> --out <bundle>\`.`
			)
		);
	}
	if (!source && !bundle)
		return missing(`It holds neither \`${PLUGIN_SOURCE}\` nor \`${PLUGIN_MANIFEST}\`.`);
	const name = source ? PLUGIN_SOURCE : PLUGIN_MANIFEST;
	const problem = await placeProblem(root, name, 'file');
	if (problem) return no(placeRefusal(name, `\`${name}\` ${problem}.`));
	if ((await lstat(join(root, name))).size > PLUGIN_BUNDLE_LIMITS.manifestBytes)
		return no(tooLarge(name));
	const bytes = await readFile(join(root, name));
	try {
		return {
			ok: true,
			found: { form: source ? 'source' : 'bundle', file: name, bytes, text: UTF8.decode(bytes) },
		};
	} catch {
		return no(
			finding(
				'PLUGIN_MANIFEST_INVALID',
				name,
				`\`${name}\` is not UTF-8.`,
				'Save the manifest as UTF-8: every name and title in it is shown at consent as written.'
			)
		);
	}
}

const tooLarge = (name: string): Finding =>
	finding(
		'PLUGIN_BUNDLE_TOO_LARGE',
		name,
		`\`${name}\` is larger than 1 MiB.`,
		'Keep the manifest under 1 MiB: it names apps and artifacts, and holds none of them.'
	);

/** The document a manifest file holds, tagged, so nothing in the document can pass for the reader's own result. */
function parseManifest({
	text,
	form,
	file,
}: ManifestFile): { ok: true; json: unknown } | { ok: false; refusal: Finding } {
	try {
		// Through JSON, so a TOML date is a string the schema refuses, as `app check` reads its file.
		return {
			ok: true,
			json: form === 'source' ? JSON.parse(JSON.stringify(parseToml(text))) : JSON.parse(text),
		};
	} catch (cause) {
		return {
			ok: false,
			refusal: finding(
				'PLUGIN_MANIFEST_INVALID',
				file,
				`\`${file}\` is not ${form === 'source' ? 'TOML' : 'JSON'}: ${cause instanceof Error ? cause.message : String(cause)}`,
				'Fix the syntax at the place the message names.'
			),
		};
	}
}

/** Each refusal once: a link found by an app's listing and by the bundle's is one problem. */
const unique = (refusals: readonly Finding[]): Finding[] => [
	...new Map(
		refusals.map((refusal) => [`${refusal.code} ${refusal.key} ${refusal.message}`, refusal])
	).values(),
];

/** A path a packed manifest names, as its package's own relative path (`./dist/a.js` is `dist/a.js`). */
const packagePath = (path: string): string => posix.normalize(path).replace(/^\.\//, '');

/** Each app's package: a directory with a packed `app-manifest.json` the kernel reads, the files it names, and its files. */
async function appFiles(
	root: string,
	manifest: PluginManifestV1,
	refusals: Finding[],
	budget: Budget,
	form: 'source' | 'bundle'
) {
	const files: Listed[] = [];
	const apps = new Map<string, Extract<ReturnType<typeof readManifest>, { ok: true }>>();
	for (const [index, app] of manifest.apps.entries()) {
		if (budget.exceeded) break;
		const key = `apps[${index}].path`;
		const problem = await placeProblem(root, app.path, 'directory');
		if (problem) {
			refusals.push(
				problem === 'does not exist'
					? finding(
							'PLUGIN_MANIFEST_INVALID',
							key,
							`\`${app.path}\` does not exist.`,
							`Pack the app there with \`loam app pack <app> --out <plugin>/${app.path}\`.`
						)
					: placeRefusal(key, `\`${app.path}\` ${problem}.`)
			);
			continue;
		}
		// The mark `loam app pack` leaves in its output is the source's, not the app's: a bundle does not carry it.
		const listed = (await listFiles(root, app.path, key, refusals, budget)).filter(
			({ path }) => form === 'bundle' || path !== `${app.path}/${OUTPUT_MARKER}`
		);
		files.push(...listed);
		if (budget.exceeded) break;
		const packed = listed.find(({ path }) => path === `${app.path}/app-manifest.json`);
		if (!packed) {
			refusals.push(
				finding(
					'PLUGIN_MANIFEST_INVALID',
					key,
					`\`${app.path}\` holds no \`app-manifest.json\`: a plugin carries packed apps.`,
					`Pack the app with \`loam app pack <app> --out <plugin>/${app.path}\`.`
				)
			);
			continue;
		}
		let json: unknown;
		try {
			json = JSON.parse(UTF8.decode(await readFile(packed.source)));
		} catch {
			json = undefined;
		}
		const read = json === undefined ? undefined : readManifest(json);
		if (!read?.ok) {
			const codes = (read?.refusals ?? []).map((refusal) => `${refusal.code} at ${refusal.key}`);
			refusals.push(
				finding(
					'PLUGIN_MANIFEST_INVALID',
					key,
					`\`${app.path}/app-manifest.json\` is refused: ${read ? codes.join(', ') : 'it is not UTF-8 JSON'}.`,
					`Check the app with \`loam app check\`, then pack it again with \`loam app pack <app> --out <plugin>/${app.path}\`.`
				)
			);
			continue;
		}
		// What the app loads must be in its package: a native entry, a view's handlers, a resource.
		const held = new Set(listed.map(({ path }) => path.slice(app.path.length + 1)));
		for (const { path, pointer } of builtPaths(read.manifest)) {
			if (!held.has(packagePath(path))) {
				refusals.push(
					finding(
						'PLUGIN_MANIFEST_INVALID',
						key,
						`\`${app.path}/app-manifest.json\` names \`${path}\` at \`${pointer}\`, which the package does not hold.`,
						`Build the app, then pack it again with \`loam app pack <app> --out <plugin>/${app.path}\`.`
					)
				);
			}
		}
		apps.set(app.id, read);
	}
	refusals.push(
		...pluginAppsRefusals(manifest, new Map([...apps].map(([id, read]) => [id, read.manifest])))
	);
	return files;
}

/** Each engine artifact: a regular file, within the budget, whose bytes hash to what the manifest pins. */
async function engineFiles(
	root: string,
	manifest: PluginManifestV1,
	refusals: Finding[],
	budget: Budget
) {
	const files: BundleFile[] = [];
	const engines: Array<{ target: string; path: string; sha256: string }> = [];
	for (const target of PLUGIN_TARGETS_V1) {
		const artifact = manifest.engine?.artifacts[target];
		if (!artifact || budget.exceeded) continue;
		const key = `engine.artifacts["${target}"].path`;
		const problem = await placeProblem(root, artifact.path, 'file');
		if (problem) {
			refusals.push(
				problem === 'does not exist'
					? finding(
							'PLUGIN_MANIFEST_INVALID',
							key,
							`\`${artifact.path}\` does not exist.`,
							`Build the engine for \`${target}\` and put it at \`${artifact.path}\`, or remove the target.`
						)
					: placeRefusal(key, `\`${artifact.path}\` ${problem}.`)
			);
			continue;
		}
		const source = join(root, ...artifact.path.split('/'));
		const { size } = await lstat(source);
		if (!budget.take(size)) break;
		const digest = await fileSha256(source);
		if (digest !== artifact.sha256) {
			refusals.push(
				finding(
					'PLUGIN_HASH_MISMATCH',
					`engine.artifacts["${target}"].sha256`,
					`\`${artifact.path}\`'s SHA-256 is not the one the manifest pins.`,
					`If this binary is the one to ship, set \`sha256 = "${digest}"\`; otherwise put the pinned build there.`
				)
			);
			continue;
		}
		files.push({ path: artifact.path, source, size, sha256: digest });
		engines.push({ target, path: artifact.path, sha256: digest });
	}
	return { files, engines };
}

/**
 * Two paths that one case-insensitive file system would make one (macOS's and Windows' defaults), compared at every
 * segment as `foldBundlePath` folds them: `apps/Mail/a` and `apps/mail/b` share a directory there, and a file named as another path's directory
 * (`apps/a` and `apps/A/b`) cannot be unpacked at all.
 */
export function collisionRefusals(paths: readonly string[]): Finding[] {
	const refusals: Finding[] = [];
	/** Each folded prefix: the spelling first seen, and whether it is a file or a directory. */
	const seen = new Map<string, { spelled: string; file: boolean }>();
	for (const path of paths) {
		const segments = path.split('/');
		for (let index = 0; index < segments.length; index++) {
			const spelled = segments.slice(0, index + 1).join('/');
			const file = index === segments.length - 1;
			const held = seen.get(foldBundlePath(spelled));
			if (!held) {
				seen.set(foldBundlePath(spelled), { spelled, file });
				continue;
			}
			if (held.file !== file) {
				refusals.push(
					finding(
						'PLUGIN_PATH_ESCAPE',
						path,
						`\`${held.file ? held.spelled : spelled}\` is a file, and \`${held.file ? spelled : held.spelled}\` a directory, on a system that ignores case.`,
						'Give each file and directory a name of its own, ignoring case, then pack again.'
					)
				);
				break;
			}
			if (held.spelled !== spelled) {
				refusals.push(
					placeRefusal(
						path,
						`\`${spelled}\` and \`${held.spelled}\` are one ${file ? 'file' : 'directory'} on a system that ignores case, such as macOS or Windows.`
					)
				);
				break;
			}
		}
	}
	return refusals;
}

/** Runs every check of 4.4 that a directory can show, and reports all it finds. */
export async function pluginCheck(options: { dir?: string } = {}): Promise<PluginCheckReport> {
	// The directory named may be a link to the plugin, as `plugin pack` reads it; nothing below it may.
	const named = resolve(options.dir ?? '.');
	const root = await realpath(named).catch(() => named);
	if (
		root.endsWith(PLUGIN_ARCHIVE_EXTENSION) &&
		(await lstat(root).catch(() => undefined))?.isFile()
	)
		return checkPluginArchive(root, pluginCheck, PLUGIN_BUNDLE_LIMITS);
	const refused = (refusals: Finding[], rest: Partial<PluginCheckReport> = {}) => ({
		ok: false,
		refusals,
		...rest,
	});
	const source = await manifestSource(root);
	if (!source.ok) return refused([source.refusal]);
	const { found } = source;
	const parsed = parseManifest(found);
	if (!parsed.ok) return refused([parsed.refusal], { form: found.form });
	const read = readPluginManifest(parsed.json);
	if (!read.ok) return refused(read.refusals, { form: found.form });
	const { manifest } = read;
	// The bytes the digest names: a bundle's own, or the ones `plugin pack` will write from a source.
	const manifestBytes =
		found.form === 'bundle' ? found.bytes : Buffer.from(packedManifestText(manifest));
	if (manifestBytes.length > PLUGIN_BUNDLE_LIMITS.manifestBytes)
		return refused([tooLarge(PLUGIN_MANIFEST)], { form: found.form, manifest });

	const refusals: Finding[] = [];
	const budget = new Budget(manifestBytes.length);
	const appListed = await appFiles(root, manifest, refusals, budget, found.form);
	const { files: engineListed, engines } = await engineFiles(root, manifest, refusals, budget);
	if (budget.exceeded) {
		return refused(
			[
				finding(
					'PLUGIN_BUNDLE_TOO_LARGE',
					'(root)',
					`The bundle holds more than ${PLUGIN_BUNDLE_LIMITS.files} files or ${PLUGIN_BUNDLE_LIMITS.bytes} bytes.`,
					'Keep the plugin bundle under 256 MiB and 2,000 files.'
				),
			],
			{ form: found.form, manifest }
		);
	}
	const listed = [...appListed, ...engineListed];
	const paths = [PLUGIN_MANIFEST, ...listed.map(({ path }) => path)];
	if (new Set(listed.map(({ path }) => path)).size !== listed.length) {
		refusals.push(
			finding(
				'PLUGIN_MANIFEST_INVALID',
				'apps',
				'An app or engine is inside another one, so the bundle would hold its files twice.',
				'Give each app and engine a place of its own, such as `apps/<id>` and `engines/<target>/`.'
			)
		);
	} else refusals.push(...collisionRefusals(paths));
	if (found.form === 'bundle') {
		// A packed bundle holds its manifest, its apps and its engines, and nothing the consent screen would not show.
		const known = new Set(paths);
		// Every file is listed, the manifest among them, so a file past the bound cannot hide from this listing.
		const whole = new Budget();
		const all = await listFiles(root, '', '(root)', refusals, whole);
		if (whole.exceeded) {
			return refused(
				[
					finding(
						'PLUGIN_BUNDLE_TOO_LARGE',
						'(root)',
						`The bundle directory holds more than ${PLUGIN_BUNDLE_LIMITS.files} files or ${PLUGIN_BUNDLE_LIMITS.bytes} bytes.`,
						'Keep the plugin bundle under 256 MiB and 2,000 files, and nothing in it but what its manifest names.'
					),
				],
				{ form: found.form, manifest }
			);
		}
		for (const file of all) {
			if (!known.has(file.path)) {
				refusals.push(
					finding(
						'PLUGIN_MANIFEST_INVALID',
						file.path,
						`\`${file.path}\` is in the bundle, and the manifest names no app or engine that holds it.`,
						'Pack the bundle again with `loam plugin pack`, which writes only what the manifest names.'
					)
				);
			}
		}
	}
	if (refusals.length > 0) return refused(unique(refusals), { form: found.form, manifest });

	const files: BundleFile[] = [];
	for (const file of appListed) files.push({ ...file, sha256: await fileSha256(file.source) });
	files.push(...engineListed);
	files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
	return {
		ok: true,
		refusals: [],
		form: found.form,
		manifest,
		files,
		engines,
		bundleSha256: bundleDigest([
			{ path: PLUGIN_MANIFEST, sha256: sha256(manifestBytes) },
			...files,
		]),
	};
}
