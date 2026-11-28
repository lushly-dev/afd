/**
 * The desktop app's third-party notices (#2808): which third-party code the installers carry, and the notice
 * text each piece needs, rendered as one deterministic `THIRD_PARTY_NOTICES.txt`. `build-notices.mjs` feeds it
 * the real inputs; `test/notices.test.ts` feeds it fixtures.
 *
 * - Rust: the crates `cargo metadata` resolves from the desktop crate over normal dependencies, for every desktop
 *   target at once, so one file serves every installer and lists some crates a given platform does not build.
 *   Build dependencies, dev dependencies and proc macros run at build time and ship nothing.
 * - npm: the packages whose files the web shell's and copilot frame's builds put into their output (each build's
 *   module record), the bundler's own runtime helpers among them, and the scoped-registry polyfill the binary
 *   embeds (#2793). A file of this repository counts when a licence or notice beside it, or in a folder above it,
 *   is anything but Lushly's own MIT licence, as FAST-AF's Microsoft notice is.
 *
 * Each package's notices are the licence, copying, notice and third-party files anywhere in its source (but its
 * tests, benches, examples, fuzz targets and docs), plus any supplement below. A package that ships none gets the
 * standard text of each licence its manifest declares; one with no declared licence, or a licence with no standard
 * text here, stops the build, so nothing ships without its notice.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPPLEMENT_DIR = join(HERE, 'notices', 'supplements');

/** The standard licence texts (SPDX license-list-data), for a package that ships no licence file. */
export const LICENSE_TEXTS = join(HERE, 'notices', 'licenses');

/**
 * Notices a package's source does not carry. The WebView2 SDK's static loader, which `webview2-com-sys` links into
 * the Windows binary, under the licence of the SDK's NuGet package (`Microsoft.Web.WebView2`); and the polyfill's
 * copyright header and the licence the header links (polymer.github.io/LICENSE.txt). `ownLicense` marks a supplement
 * that is the package's own licence text, so the standard text of what it declares is not added beside it.
 */
export const SUPPLEMENTS = {
	'crate:webview2-com-sys': [
		{
			label:
				'WebView2LoaderStatic.lib, from the Microsoft WebView2 SDK (NuGet Microsoft.Web.WebView2): LICENSE.txt',
			file: join(SUPPLEMENT_DIR, 'microsoft-webview2-sdk-LICENSE.txt'),
		},
	],
	'npm:@webcomponents/scoped-custom-element-registry': [
		{
			label: 'The copyright header of scoped-custom-element-registry.min.js',
			file: join(SUPPLEMENT_DIR, 'scoped-custom-element-registry-header.txt'),
			ownLicense: true,
		},
		{
			label: 'The licence its header links: http://polymer.github.io/LICENSE.txt',
			file: join(SUPPLEMENT_DIR, 'polymer-LICENSE.txt'),
			ownLicense: true,
		},
	],
};

/** The bundler's virtual modules: each names the package whose code it is, found from the one before it. */
const VIRTUAL = [
	{ prefix: '\0vite/', chain: ['vite'] },
	{ prefix: '\0rolldown/', chain: ['vite', 'rolldown'] },
];

/** The desktop targets the notices cover, so one file serves every installer. */
export const DESKTOP_TARGETS = [
	'x86_64-unknown-linux-gnu',
	'aarch64-unknown-linux-gnu',
	'x86_64-pc-windows-msvc',
	'aarch64-pc-windows-msvc',
	'x86_64-apple-darwin',
	'aarch64-apple-darwin',
];

const NOTICE_NAME = /^(licen[cs]e|copying|copyright|notice|unlicense|ofl|third[-_ ]?party)/i;
const CODE_EXTENSION =
	/\.(c|cc|cjs|cpp|cts|css|d\.ts|go|h|hpp|html|java|js|json|map|mjs|mts|py|rs|sh|toml|ts|yaml|yml)$/i;
/** Folders whose files a package does not ship: a notice there is no notice for what it ships. */
const UNSHIPPED_DIR = /^(\.git|\.github|benches|docs?|examples?|fuzz|node_modules|target|tests?)$/i;

const BOM = 0xfeff;

/** A notice text as it is compared and printed: no BOM, LF line ends, no trailing spaces or edge blank lines. */
export function normalizeText(text) {
	return (text.charCodeAt(0) === BOM ? text.slice(1) : text)
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/^\n+|\n+$/g, '');
}

function isNoticeName(name) {
	return NOTICE_NAME.test(name) && !CODE_EXTENSION.test(name);
}

function posix(path) {
	return path.split(sep).join('/');
}

function byLabel(a, b) {
	return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * The notice files under `dir` as `{ label, file }`, `label` the path from `base` with forward slashes, sorted by
 * label so every platform orders them alike. `recursive` also reads every folder below but the unshipped ones;
 * a REUSE `LICENSES/` folder's files all count.
 */
export function noticeFilesIn(dir, { base = dir, recursive = true } = {}) {
	const out = [];
	const visit = (current, all) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isFile() && (all || isNoticeName(entry.name))) {
				out.push({ label: posix(relative(base, path)), file: path });
			} else if (entry.isDirectory()) {
				if (/^licen[cs]es$/i.test(entry.name)) visit(path, true);
				else if (recursive && !UNSHIPPED_DIR.test(entry.name)) visit(path, all);
			}
		}
	};
	visit(dir, false);
	return out.sort(byLabel);
}

/** The SPDX identifiers an expression names: `MIT OR Apache-2.0`, `(MIT AND Zlib)`, `MIT/Apache-2.0`. */
export function licenseIds(expression) {
	return [
		...new Set(
			expression
				.split(/\s+(?:AND|OR)\s+|\s+WITH\s+|[()/]/)
				.map((part) => part.trim())
				.filter(Boolean)
		),
	];
}

function standardTexts(expression, licenseTexts) {
	const files = [];
	const missing = [];
	for (const id of licenseIds(expression)) {
		const file = join(licenseTexts, `${id}.txt`);
		if (existsSync(file)) files.push({ label: `The standard text of ${id}`, file });
		else missing.push(id);
	}
	return { files, missing };
}

/**
 * Each package's notice texts: its own files and supplements, else the standard text of each licence it declares.
 * Throws one error naming every package left without a notice.
 */
export function resolveNotices(
	packages,
	{ licenseTexts = LICENSE_TEXTS, supplements = SUPPLEMENTS } = {}
) {
	const problems = [];
	const resolved = packages.map((pkg) => {
		const id = `${pkg.kind} ${pkg.name}@${pkg.version}`;
		const extra = supplements[`${pkg.kind}:${pkg.name}`] ?? [];
		let notices = [...pkg.files, ...extra];
		let standard = false;
		if (pkg.files.length === 0 && !extra.some((item) => item.ownLicense)) {
			standard = true;
			if (!pkg.license || licenseIds(pkg.license).length === 0) {
				problems.push(`${id} ships no licence file and declares no licence`);
			} else {
				const { files, missing } = standardTexts(pkg.license, licenseTexts);
				if (missing.length > 0)
					problems.push(
						`${id} ships no licence file, and there is no standard text for ${missing.join(', ')} in ${licenseTexts}`
					);
				notices = [...files, ...extra];
			}
		}
		return {
			...pkg,
			standard,
			notices: notices.map(({ label, file }) => ({
				label,
				text: normalizeText(readFileSync(file, 'utf8')),
			})),
		};
	});
	if (problems.length > 0) {
		throw new Error(`Third-party notices are missing (#2808):\n- ${problems.join('\n- ')}`);
	}
	return resolved;
}

/** The crates compiled into the app: from the root over normal dependencies, without proc macros or the root. */
export function rustCrates(metadata) {
	const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
	const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
	const root = metadata.resolve.root;
	const seen = new Set([root]);
	const stack = [root];
	while (stack.length > 0) {
		const node = nodes.get(stack.pop());
		for (const dep of node?.deps ?? []) {
			if (seen.has(dep.pkg) || !dep.dep_kinds.some((kind) => kind.kind === null)) continue;
			const pkg = packages.get(dep.pkg);
			if (pkg.targets.some((target) => target.kind.includes('proc-macro'))) continue;
			seen.add(dep.pkg);
			stack.push(dep.pkg);
		}
	}
	seen.delete(root);
	return [...seen].map((id) => {
		const pkg = packages.get(id);
		const dir = dirname(pkg.manifest_path);
		const files = noticeFilesIn(dir);
		if (pkg.license_file) {
			const file = resolve(dir, pkg.license_file);
			const label = posix(relative(dir, file));
			if (!files.some((item) => item.label === label)) files.push({ label, file });
			files.sort(byLabel);
		}
		return {
			kind: 'crate',
			name: pkg.name,
			version: pkg.version,
			license: pkg.license ?? null,
			authors: pkg.authors ?? [],
			url: pkg.repository ?? pkg.homepage ?? null,
			files,
		};
	});
}

function readJson(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}

function npmLicense(manifest) {
	if (typeof manifest.license === 'string') return manifest.license;
	if (manifest.license?.type) return manifest.license.type;
	if (Array.isArray(manifest.licenses))
		return manifest.licenses.map((item) => item.type ?? item).join(' OR ');
	return null;
}

function npmAuthors(manifest) {
	const name = (person) => (typeof person === 'string' ? person : person?.name);
	return [manifest.author, ...(manifest.contributors ?? [])].map(name).filter(Boolean);
}

function npmUrl(manifest) {
	const repo =
		typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
	return repo ?? manifest.homepage ?? null;
}

/** `name`'s directory as Node would find it from `from`, through each `node_modules` above it. */
export function findPackage(name, from) {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', ...name.split('/'));
		if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
		if (dirname(dir) === dir)
			throw new Error(`${name} is not installed where ${from} would find it`);
	}
}

/** The package directory (`node_modules/<name>` or `node_modules/@scope/<name>`) a module path is in, or null. */
export function packageRootOf(path) {
	const marker = '/node_modules/';
	const at = path.lastIndexOf(marker);
	if (at < 0) return null;
	const rest = path.slice(at + marker.length).split('/');
	const segments = rest[0].startsWith('@') ? 2 : 1;
	return path.slice(0, at + marker.length) + rest.slice(0, segments).join('/');
}

function nearestManifest(dir, repoRoot) {
	for (let current = dir; ; current = dirname(current)) {
		if (existsSync(join(current, 'package.json'))) return current;
		if (current === repoRoot || dirname(current) === current) return null;
	}
}

/**
 * Lushly's own MIT licence (as the repository's root `LICENSE` is): every line that states a copyright (one that
 * starts with `Copyright`, or holds `©`) names Lushly.
 */
export function isFirstPartyLicense(text) {
	const normalized = normalizeText(text);
	if (!/^MIT License\b/.test(normalized)) return false;
	const copyrights = normalized.split('\n').filter((line) => /^\s*copyright\b|©/i.test(line));
	return copyrights.length > 0 && copyrights.every((line) => /Lushly/.test(line));
}

/**
 * A build's module record as `npmPackages` reads it. Its paths are written relative to the record's own folder
 * (`web/scripts/module-record.mjs`, `copilot/scripts/build-frame.mjs`), so it names no machine's paths; here they
 * are made absolute again, with forward slashes. A virtual module (`\0...`) stays as it is.
 */
export function readModuleRecord(file) {
	const base = dirname(resolve(file));
	const absolute = (path) => (path.startsWith('\0') ? path : posix(resolve(base, path)));
	const record = JSON.parse(readFileSync(file, 'utf8'));
	return {
		resolveFrom: absolute(String(record.resolveFrom ?? '.')),
		modules: Array.isArray(record.modules) ? record.modules.map((id) => absolute(String(id))) : [],
	};
}

/**
 * The npm packages and repository folders the given module records' files come from. `records` are
 * `{ resolveFrom, modules }`; `extra` are package directories shipped outside a bundle.
 */
export function npmPackages(records, { repoRoot, extra = [] }) {
	const root = realpathSync(resolve(repoRoot));
	const external = new Set(extra.map((dir) => realpathSync(dir)));
	const workspace = new Map();
	const problems = [];
	for (const record of records) {
		for (const id of record.modules) {
			if (id.startsWith('\0')) {
				const virtual = VIRTUAL.find((item) => id.startsWith(item.prefix));
				if (!virtual) {
					problems.push(`an unknown virtual module ${JSON.stringify(id)}`);
					continue;
				}
				let from = resolve(record.resolveFrom);
				for (const name of virtual.chain) from = findPackage(name, from);
				external.add(from);
				continue;
			}
			const pkg = packageRootOf(posix(resolve(id)));
			if (pkg) {
				external.add(realpathSync(pkg));
				continue;
			}
			const path = existsSync(id) ? realpathSync(id) : resolve(id);
			if (path !== root && !path.startsWith(root + sep)) {
				problems.push(`a module outside the repository and any node_modules: ${id}`);
				continue;
			}
			const manifest = nearestManifest(dirname(path), root);
			if (!manifest) {
				problems.push(`a repository module in no package: ${id}`);
				continue;
			}
			const entry = workspace.get(manifest) ?? new Map();
			for (let dir = dirname(path); dir !== root && dirname(dir) !== dir; dir = dirname(dir)) {
				for (const item of noticeFilesIn(dir, { base: root, recursive: false }))
					entry.set(item.label, item);
			}
			workspace.set(manifest, entry);
		}
	}
	if (problems.length > 0) {
		throw new Error(
			`The module records name files with no package (#2808):\n- ${problems.join('\n- ')}`
		);
	}
	const out = [];
	for (const dir of external) {
		const manifest = readJson(join(dir, 'package.json'));
		out.push({
			kind: 'npm',
			name: manifest.name,
			version: manifest.version,
			license: npmLicense(manifest),
			authors: npmAuthors(manifest),
			url: npmUrl(manifest),
			files: noticeFilesIn(dir),
		});
	}
	for (const [dir, files] of workspace) {
		const own = [...files.values()].sort(byLabel);
		if (own.every((item) => isFirstPartyLicense(readFileSync(item.file, 'utf8')))) continue;
		const manifest = readJson(join(dir, 'package.json'));
		out.push({
			kind: 'workspace',
			name: manifest.name,
			version: manifest.version ?? '0.0.0',
			license: npmLicense(manifest),
			authors: [],
			url: `this repository, ${posix(relative(root, dir))}`,
			files: own,
		});
	}
	return out;
}

function byNameAndVersion(a, b) {
	const key = (pkg) => `${pkg.name}\u0000${pkg.version}`;
	return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

/**
 * One package per kind, name and version (pnpm keeps a copy per peer set): every notice file any copy ships, by
 * its path within the copy, so the result is the same whichever copy came first.
 */
export function dedupePackages(packages) {
	const out = new Map();
	for (const pkg of packages) {
		const key = `${pkg.kind}\u0000${pkg.name}\u0000${pkg.version}`;
		const seen = out.get(key);
		if (seen) {
			for (const item of pkg.files)
				if (!seen.files.some((known) => known.label === item.label)) seen.files.push(item);
			seen.files.sort(byLabel);
		} else out.set(key, { ...pkg, files: [...pkg.files] });
	}
	return [...out.values()];
}

/**
 * The notice file: a header, one list per section (each entry pointing at its texts by number), then every
 * distinct text once, numbered in the order the lists first use it. Byte-identical for the same inputs.
 */
export function renderNotices({ product, version, preamble = [], sections }) {
	const texts = new Map();
	const textNumber = (text) => {
		if (!texts.has(text)) texts.set(text, texts.size + 1);
		return texts.get(text);
	};
	const rule = '='.repeat(78);
	const lines = [`Third-party notices for ${product} ${version}`, ''];
	for (const paragraph of preamble) lines.push(paragraph, '');
	for (const section of sections) {
		const entries = [...section.packages].sort(byNameAndVersion);
		lines.push(rule, `${section.title} (${entries.length})`, rule, '');
		for (const pkg of entries) {
			lines.push(`${pkg.name} ${pkg.version}`);
			lines.push(`  Licence: ${pkg.license ?? '(not declared)'}`);
			if (pkg.url) lines.push(`  Source: ${pkg.url}`);
			if (pkg.standard && pkg.authors.length > 0)
				lines.push(`  Authors: ${pkg.authors.join(', ')}`);
			if (pkg.standard)
				lines.push('  It ships no licence file: the standard text of each licence it declares.');
			for (const notice of pkg.notices)
				lines.push(`  [${textNumber(notice.text)}] ${notice.label}`);
			lines.push('');
		}
	}
	lines.push(rule, `Notice texts (${texts.size})`, rule, '');
	for (const [text, number] of texts) {
		lines.push(`-------- [${number}] ${'-'.repeat(60)}`, '', text, '');
	}
	return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
