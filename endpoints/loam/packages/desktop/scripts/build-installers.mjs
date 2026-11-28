#!/usr/bin/env node
/**
 * Builds unsigned desktop installers for the current operating system (phase 6 specification,
 * 10.7, 11.3, 14 and P6-D5), stages them into `dist-installers/`, writes `SHA256SUMS.txt`, and
 * records each installer's size in `test-results/installers-<platform>.json`. Every installer carries the
 * third-party notices (#2808): `build-notices.mjs` writes them first, and `tauri build` bundles them as resources
 * beside the app through the `--config` it writes.
 *
 * Expects `dist/` to already contain the bundled empty shell (`pnpm build:site`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNotices, TAURI_CONFIG } from './build-notices.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const SRC_TAURI = join(PACKAGE, 'src-tauri');
const OUT = join(PACKAGE, 'dist-installers');
const RESULTS = join(PACKAGE, 'test-results');
const TAURI_CONF = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8'));

if (!existsSync(join(PACKAGE, 'dist/index.html'))) {
	console.error(
		'dist/index.html is missing: run `pnpm -F @lushly-dev/loam-desktop build:site` first'
	);
	process.exit(1);
}

const BUNDLES_BY_PLATFORM = {
	linux: ['deb', 'appimage'],
	win32: ['msi'],
	darwin: ['app', 'dmg'],
};

const bundles = BUNDLES_BY_PLATFORM[process.platform];
if (!bundles) {
	console.error(`Unsupported desktop installer platform: ${process.platform}`);
	process.exit(1);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: PACKAGE,
		stdio: 'inherit',
		...options,
	});
	if (result.error) {
		console.error(`Failed to run ${command}: ${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

// Quarantine builds are always unsigned (D112): strip ambient signing/notarization env vars and
// pass `--no-sign` so a developer machine's identity can never silently sign a build recorded as
// `signed: false`.
const SIGNING_ENV_VARS = [
	'APPLE_SIGNING_IDENTITY',
	'APPLE_CERTIFICATE',
	'APPLE_CERTIFICATE_PASSWORD',
	'APPLE_ID',
	'APPLE_PASSWORD',
	'APPLE_TEAM_ID',
	'APPLE_API_KEY',
	'APPLE_API_ISSUER',
	'APPLE_API_KEY_PATH',
	'TAURI_SIGNING_PRIVATE_KEY',
	'TAURI_SIGNING_PRIVATE_KEY_PATH',
	'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
];
const tauriEnv = { ...process.env };
for (const key of SIGNING_ENV_VARS) {
	delete tauriEnv[key];
}
if (process.platform === 'linux') {
	// Modern Ubuntu toolchains emit `.relr.dyn` sections that linuxdeploy's bundled `strip` rejects,
	// and GitHub Actions containers lack FUSE for mounting AppImages during packaging.
	tauriEnv.NO_STRIP ??= 'true';
	tauriEnv.APPIMAGE_EXTRACT_AND_RUN ??= '1';
}

const targetDir = process.env.CARGO_TARGET_DIR
	? resolve(SRC_TAURI, process.env.CARGO_TARGET_DIR)
	: join(SRC_TAURI, 'target');
const bundleRoot = join(targetDir, 'release', 'bundle');

// Clean prior bundle outputs so a reused Cargo target directory can never stage an older version.
rmSync(bundleRoot, { recursive: true, force: true });

const notices = buildNotices();
console.log(
	`third-party notices: ${notices.crates} crates, ${notices.npm} npm and repository packages`
);

const tauriCli = join(PACKAGE, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
run(
	process.execPath,
	[
		tauriCli,
		'build',
		'--no-sign',
		'--bundles',
		bundles.join(','),
		'--config',
		TAURI_CONFIG,
		'--',
		'--locked',
	],
	{ env: tauriEnv }
);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

function copyMatching(subDir, suffix) {
	const dir = join(bundleRoot, subDir);
	if (!existsSync(dir)) {
		throw new Error(`Expected Tauri bundle directory missing: ${dir}`);
	}
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(suffix) && name.includes(TAURI_CONF.version))
		.sort();
	if (files.length !== 1) {
		throw new Error(
			`Expected exactly 1 ${suffix} installer for version ${TAURI_CONF.version} in ${dir}, found: ${files.join(', ') || '(none)'}`
		);
	}
	for (const name of files) {
		copyFileSync(join(dir, name), join(OUT, name));
	}
}

if (process.platform === 'linux') {
	copyMatching('deb', '.deb');
	copyMatching('appimage', '.AppImage');
} else if (process.platform === 'win32') {
	copyMatching('msi', '.msi');
} else if (process.platform === 'darwin') {
	const macosDir = join(bundleRoot, 'macos');
	const appName = `${TAURI_CONF.productName}.app`;
	const appBinary = join(macosDir, appName, 'Contents', 'MacOS', 'loam-desktop');
	if (!existsSync(appBinary)) {
		throw new Error(`Expected macOS app binary missing: ${appBinary}`);
	}
	const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
	const archiveName = `${TAURI_CONF.productName}_${TAURI_CONF.version}_${arch}.app.tar.gz`;
	run('tar', ['-czf', join(OUT, archiveName), '-C', macosDir, appName], { shell: false });
	copyMatching('dmg', '.dmg');
}

const staged = readdirSync(OUT)
	.filter((name) => name !== 'SHA256SUMS.txt')
	.sort();

const records = staged.map((name) => {
	const filePath = join(OUT, name);
	const bytes = readFileSync(filePath);
	const sizeBytes = statSync(filePath).size;
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { name, sizeBytes, sha256 };
});

const sums = `${records.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n')}\n`;
writeFileSync(join(OUT, 'SHA256SUMS.txt'), sums, 'utf8');

const summary = {
	platform: process.platform,
	arch: process.arch,
	version: TAURI_CONF.version,
	signed: false,
	installers: records,
};
writeFileSync(
	join(RESULTS, `installers-${process.platform}.json`),
	`${JSON.stringify(summary, null, '\t')}\n`,
	'utf8'
);

for (const entry of records) {
	const mib = (entry.sizeBytes / (1024 * 1024)).toFixed(2);
	console.log(
		`installer (${process.platform}): ${entry.name}  ${entry.sizeBytes} bytes (${mib} MiB)  sha256=${entry.sha256}`
	);
}
