#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { cpus, homedir, platform, release, totalmem } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Records one consumer snapshot's input identities: source bytes against the pinned Git tree,
// lockfile-to-install agreement, selected installed packages, vendored artifacts, static and
// remote assets, browsers, host and the declared baseline policy. It reads the snapshot and the
// source repository only; it installs, prepares or modifies nothing.

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** Git's blob id; for a symlink Git hashes the link text, not the target. */
export const gitBlob = (bytes) =>
	createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const CHROMIUM_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

function run(command, args, options = {}) {
	try {
		return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options }).trim();
	} catch (error) {
		return { error: String(error.message).split('\n')[0] };
	}
}

/** Files below a directory, skipping nested node_modules, as sorted relative paths. */
async function walk(root, { skipNodeModules = true } = {}) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (skipNodeModules && entry.name === 'node_modules') continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative(root, path));
		}
	}
	await visit(root);
	return files.sort();
}

/** Digest of every file below root outside node_modules; symlinks contribute their link text. */
export async function contentDigest(root) {
	const lines = [];
	let bytes = 0;
	for (const file of await walk(root)) {
		const path = join(root, file);
		const stats = await lstat(path);
		// Record the link text so the digest does not depend on where the snapshot lives.
		if (stats.isSymbolicLink()) {
			lines.push(`${file}\0link\0${await readlink(path)}`);
			continue;
		}
		const content = await readFile(path);
		bytes += content.length;
		lines.push(`${file}\0${sha256(content)}`);
	}
	return { files: lines.length, bytes, sha256: sha256(lines.join('\n')) };
}

/** Parse `git ls-tree -r -z` output; paths may contain tabs or spaces. */
export function parseTree(listing) {
	const blobs = new Map();
	const submodules = [];
	for (const line of listing.split('\0').filter(Boolean)) {
		const tab = line.indexOf('\t');
		const [mode, type, object] = line.slice(0, tab).split(' ');
		const path = line.slice(tab + 1);
		if (type === 'blob') blobs.set(path, { mode, object });
		else if (type === 'commit') submodules.push({ path, object });
	}
	return { blobs, submodules };
}

/** Compare one snapshot file with its tree entry by content, link text and executable bit. */
export async function compareEntry(absolute, { mode, object }) {
	const stats = await lstat(absolute);
	if (mode === '120000') {
		if (!stats.isSymbolicLink()) return 'not-a-symlink';
		return gitBlob(Buffer.from(await readlink(absolute))) === object ? null : 'content';
	}
	if (stats.isSymbolicLink()) return 'unexpected-symlink';
	if (gitBlob(await readFile(absolute)) !== object) return 'content';
	const executable = (stats.mode & 0o111) !== 0;
	return executable === (mode === '100755') ? null : 'mode';
}

/** Bind every snapshot file outside node_modules to the pinned Git tree. */
async function bindSource(snapshot, repository, revision) {
	const listing = execFileSync(
		'git',
		['-C', repository, 'ls-tree', '-r', '-z', '--full-tree', revision],
		{
			maxBuffer: 1 << 28,
		}
	).toString('utf8');
	const { blobs: tracked, submodules } = parseTree(listing);
	const present = new Set(await walk(snapshot));
	const missing = [];
	const modified = [];
	for (const [path, { mode, object }] of tracked) {
		if (!present.has(path)) {
			missing.push(path);
			continue;
		}
		const difference = await compareEntry(join(snapshot, path), { mode, object });
		if (difference) modified.push({ path, difference });
	}
	const generated = [];
	for (const path of present) {
		if (tracked.has(path)) continue;
		const absolute = join(snapshot, path);
		if ((await lstat(absolute)).isSymbolicLink()) {
			generated.push({ path, link: await readlink(absolute) });
			continue;
		}
		const content = await readFile(absolute);
		generated.push({ path, bytes: content.length, sha256: sha256(content) });
	}
	return {
		repository,
		revision,
		tree: run('git', ['-C', repository, 'rev-parse', `${revision}^{tree}`]),
		committed: run('git', ['-C', repository, 'show', '-s', '--format=%cI', revision]),
		trackedFiles: tracked.size,
		submodules,
		missing,
		modified,
		// Re-checked by consumer runners so later edits to the snapshot are detected.
		snapshotDigest: await contentDigest(snapshot),
		generatedOrUntracked: {
			count: generated.length,
			sha256: sha256(JSON.stringify(generated)),
			files: generated,
		},
	};
}

async function bindInstall(snapshot) {
	const lockfile = await readFile(join(snapshot, 'pnpm-lock.yaml'));
	const installed = await readFile(join(snapshot, 'node_modules/.pnpm/lock.yaml')).catch(
		() => undefined
	);
	const modules = await readFile(join(snapshot, 'node_modules/.modules.yaml'), 'utf8').catch(
		() => ''
	);
	const field = (name) =>
		modules.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1]?.replace(/^['"]|['"]$/g, '');
	const entries = (await readdir(join(snapshot, 'node_modules/.pnpm')))
		.filter((name) => name !== 'lock.yaml')
		.sort();
	return {
		lockfileSha256: sha256(lockfile),
		installedLockSha256: installed ? sha256(installed) : null,
		lockfileMatchesInstall: installed ? sha256(lockfile) === sha256(installed) : false,
		packageManager: field('packageManager') ?? null,
		declaredPackageManager:
			JSON.parse(await readFile(join(snapshot, 'package.json'), 'utf8')).packageManager ?? null,
		layoutVersion: field('layoutVersion'),
		nodeLinker: field('nodeLinker'),
		virtualStore: { entries: entries.length, sha256: sha256(entries.join('\n')) },
	};
}

/** Resolve `name` or `parent>child` from a workspace directory to the installed package directory. */
async function resolvePackage(snapshot, workspace, spec) {
	const [first, ...rest] = spec.split('>');
	let directory = await realpath(join(snapshot, workspace, 'node_modules', first)).catch(() =>
		realpath(join(snapshot, 'node_modules', first))
	);
	for (const name of rest) {
		let found;
		for (let parent = directory; parent !== dirname(parent); parent = dirname(parent)) {
			if (basename(parent) !== 'node_modules') continue;
			if (existsSync(join(parent, name))) {
				found = await realpath(join(parent, name));
				break;
			}
		}
		if (!found) throw new Error(`Cannot resolve ${spec} from ${workspace}`);
		directory = found;
	}
	return directory;
}

async function bindPackages(snapshot, packages) {
	const records = [];
	for (const [workspace, specs] of Object.entries(packages)) {
		for (const spec of specs) {
			// Older or differently laid-out snapshots may not install every descriptor package.
			const directory = await resolvePackage(snapshot, workspace, spec).catch(() => undefined);
			if (!directory) {
				records.push({ workspace, spec, missing: true });
				continue;
			}
			const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
			records.push({
				workspace,
				spec,
				name: manifest.name,
				version: manifest.version,
				location: relative(snapshot, directory),
				content: await contentDigest(directory),
			});
		}
	}
	return records;
}

async function hashFiles(snapshot, paths) {
	const records = [];
	for (const path of paths) {
		const content = await readFile(join(snapshot, path)).catch(() => undefined);
		records.push(
			content ? { path, bytes: content.length, sha256: sha256(content) } : { path, missing: true }
		);
	}
	return records;
}

async function fetchBytes(url, headers) {
	try {
		const response = await fetch(url, { headers });
		const bytes = Buffer.from(await response.arrayBuffer());
		return { status: response.status, ok: response.ok, bytes };
	} catch (error) {
		return { status: null, ok: false, error: String(error.message ?? error) };
	}
}

async function bindRemote(snapshot, htmlFiles, fetchRemote) {
	const records = [];
	for (const file of htmlFiles) {
		const html = await readFile(join(snapshot, file), 'utf8');
		for (const [, , url] of html.matchAll(/(?:href|src)=(["'])(https?:\/\/.+?)\1/g)) {
			const record = { from: file, url: url.replaceAll('&amp;', '&'), fetched: false };
			records.push(record);
			if (!fetchRemote || !/fonts\.googleapis\.com\/css/.test(record.url)) continue;
			// Google varies the stylesheet by user agent; the recorded copy is for this agent only.
			const stylesheet = await fetchBytes(record.url, { 'user-agent': CHROMIUM_UA });
			Object.assign(record, { userAgent: CHROMIUM_UA, status: stylesheet.status });
			if (!stylesheet.ok) {
				record.error = stylesheet.error ?? `HTTP ${stylesheet.status}`;
				continue;
			}
			const css = stylesheet.bytes;
			Object.assign(record, { fetched: true, bytes: css.length, sha256: sha256(css) });
			record.fonts = [];
			for (const [, font] of css.toString('utf8').matchAll(/url\((https:[^)]+)\)/g)) {
				const response = await fetchBytes(font, { 'user-agent': CHROMIUM_UA });
				record.fonts.push(
					response.ok
						? {
								url: font,
								status: response.status,
								bytes: response.bytes.length,
								sha256: sha256(response.bytes),
							}
						: {
								url: font,
								status: response.status,
								error: response.error ?? `HTTP ${response.status}`,
							}
				);
			}
			record.fontErrors = record.fonts.filter((font) => font.error).length;
			record.fontBytes = record.fonts.reduce((total, font) => total + (font.bytes ?? 0), 0);
		}
	}
	return records;
}

async function bindBrowsers(snapshot, packages) {
	const cache =
		process.env.PLAYWRIGHT_BROWSERS_PATH ??
		(platform() === 'darwin'
			? join(homedir(), 'Library/Caches/ms-playwright')
			: join(homedir(), '.cache/ms-playwright'));
	const records = [];
	for (const record of packages.filter((item) => item.name === 'playwright-core')) {
		const { browsers } = JSON.parse(
			await readFile(join(snapshot, record.location, 'browsers.json'), 'utf8')
		);
		for (const browser of browsers.filter((item) => item.name.startsWith('chromium'))) {
			const directory = join(cache, `${browser.name.replaceAll('-', '_')}-${browser.revision}`);
			// Presence of Playwright's completion marker, not a binary digest.
			const complete = existsSync(join(directory, 'INSTALLATION_COMPLETE'));
			records.push({
				playwrightCore: record.version,
				name: browser.name,
				revision: browser.revision,
				browserVersion: browser.browserVersion,
				present: complete,
				installPath: complete ? directory : null,
			});
		}
	}
	return records;
}

async function host() {
	const sysctl = (name) => run('sysctl', ['-n', name]);
	const node = await readFile(process.execPath);
	return {
		platform: platform(),
		kernel: release(),
		os:
			platform() === 'darwin'
				? `${run('sw_vers', ['-productVersion'])} (${run('sw_vers', ['-buildVersion'])})`
				: null,
		model: platform() === 'darwin' ? sysctl('hw.model') : null,
		cpu: cpus()[0]?.model,
		logicalCores: cpus().length,
		performanceCores: platform() === 'darwin' ? Number(sysctl('hw.perflevel0.logicalcpu')) : null,
		efficiencyCores: platform() === 'darwin' ? Number(sysctl('hw.perflevel1.logicalcpu')) : null,
		memoryBytes: totalmem(),
		node: { version: process.version, execPath: process.execPath, sha256: sha256(node) },
	};
}

async function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		if (index >= 0 && args[index + 1]) return args[index + 1];
		if (fallback === undefined) throw new Error(`${name} is required`);
		return fallback;
	};
	const consumer = option('--consumer');
	const descriptors = JSON.parse(await readFile(join(here, 'consumers.json'), 'utf8'));
	const descriptor = descriptors.consumers[consumer];
	if (!descriptor) throw new Error(`Unknown consumer ${consumer}`);
	const snapshot = resolve(option('--snapshot'));
	const repository = resolve(option('--repo'));
	const revision = option('--revision');
	if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('--revision must be a full commit SHA');
	const policyText = await readFile(join(here, 'baseline-policy.json'));
	const packages = await bindPackages(snapshot, descriptor.packages);
	const manifest = {
		schema: 'specimen-frozen-inputs/1',
		consumer,
		recordedAt: new Date().toISOString(),
		snapshot,
		descriptor,
		source: await bindSource(snapshot, repository, revision),
		install: await bindInstall(snapshot),
		packages,
		vendor: await hashFiles(snapshot, descriptor.vendor),
		configFiles: await hashFiles(snapshot, descriptor.configFiles),
		obligations: await Promise.all(
			descriptor.obligations.map(async (item) => ({
				...item,
				files: await hashFiles(snapshot, item.files),
			}))
		),
		staticDirs: await Promise.all(
			descriptor.staticDirs.map(async (path) =>
				existsSync(join(snapshot, path))
					? { path, ...(await contentDigest(join(snapshot, path))) }
					: { path, missing: true }
			)
		),
		remoteAssets: await bindRemote(
			snapshot,
			descriptor.remoteHtml,
			args.includes('--fetch-remote')
		),
		browsers: await bindBrowsers(snapshot, packages),
		host: await host(),
		policy: { sha256: sha256(policyText), ...JSON.parse(policyText) },
	};
	await writeFile(resolve(option('--out')), `${JSON.stringify(manifest, null, '\t')}\n`);
	const summary = {
		consumer,
		revision,
		trackedFiles: manifest.source.trackedFiles,
		missing: manifest.source.missing.length,
		modified: manifest.source.modified.length,
		generatedOrUntracked: manifest.source.generatedOrUntracked.count,
		lockfileMatchesInstall: manifest.install.lockfileMatchesInstall,
		virtualStoreEntries: manifest.install.virtualStore.entries,
		packages: packages.map((item) =>
			item.missing ? `${item.spec} missing` : `${item.name}@${item.version}`
		),
		browsers: manifest.browsers.map(
			(item) => `${item.name} ${item.browserVersion} r${item.revision} present=${item.present}`
		),
		remoteAssets: manifest.remoteAssets.map((item) => ({
			url: item.url.slice(0, 60),
			fetched: item.fetched,
			fonts: item.fonts?.length,
		})),
	};
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
