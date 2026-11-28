/**
 * P6-D5 (phase 6 specification, 10.6, 11.3, 14 and section 19):
 * 1. Each platform's unsigned installers are built, non-empty, hashed in `SHA256SUMS.txt`, and
 *    their sizes are recorded.
 * 2. Without an updater public key (`LOAM_UPDATER_PUBKEY` unset), no update request is made.
 * 3. With an ephemeral test key and a local HTTPS feed backed by an ephemeral test CA, a signed
 *    update installs on this platform, while a tampered payload, wrong-key signature, untrusted
 *    CA, plain HTTP feed and plain HTTP download URL are each refused.
 * And #2808: each installer carries the third-party notices `build-notices.mjs` wrote, byte for byte.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const PACKAGE = fileURLToPath(new URL('../..', import.meta.url));
const SRC_TAURI = join(PACKAGE, 'src-tauri');
const OUT = join(PACKAGE, 'dist-installers');
const RESULTS = join(PACKAGE, 'test-results');

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function opensslBin(): string {
	if (process.platform === 'win32' && process.env.ProgramFiles) {
		const gitOpenssl = join(process.env.ProgramFiles, 'Git', 'usr', 'bin', 'openssl.exe');
		if (existsSync(gitOpenssl)) return gitOpenssl;
	}
	return 'openssl';
}

function runChecked(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {}
): string {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		shell: false,
		// An AppImage's `--appimage-extract` lists every file it writes.
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} exited ${result.status}${result.error ? ` (${result.error.message})` : ''}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
		);
	}
	return result.stdout ?? '';
}

function runCheckedAsync(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			...options,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(
						`${command} ${args.join(' ')} exited ${code}\nstdout: ${stdout}\nstderr: ${stderr}`
					)
				);
				return;
			}
			resolve(stdout);
		});
	});
}

function generateTestCaAndServerCert(dir: string): {
	caCertPath: string;
	serverKey: Buffer;
	serverCert: Buffer;
} {
	const openssl = opensslBin();
	const caKey = join(dir, 'ca.key');
	const caCert = join(dir, 'ca.pem');
	const srvKey = join(dir, 'server.key');
	const srvCsr = join(dir, 'server.csr');
	const srvCert = join(dir, 'server.pem');
	const caExt = join(dir, 'ca.cnf');
	const srvExt = join(dir, 'server.cnf');

	writeFileSync(
		caExt,
		[
			'[req]',
			'distinguished_name = dn',
			'x509_extensions = v3_ca',
			'prompt = no',
			'[dn]',
			'CN = Loam P6-D5 Test CA',
			'[v3_ca]',
			'basicConstraints = critical, CA:TRUE',
			'keyUsage = critical, keyCertSign, cRLSign',
			'subjectKeyIdentifier = hash',
		].join('\n')
	);
	writeFileSync(
		srvExt,
		[
			'basicConstraints = CA:FALSE',
			'keyUsage = critical, digitalSignature, keyEncipherment',
			'extendedKeyUsage = serverAuth',
			'subjectAltName = IP:127.0.0.1, DNS:localhost',
		].join('\n')
	);

	runChecked(openssl, [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'2',
		'-keyout',
		caKey,
		'-out',
		caCert,
		'-config',
		caExt,
	]);
	runChecked(openssl, [
		'req',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-keyout',
		srvKey,
		'-out',
		srvCsr,
		'-subj',
		'/CN=127.0.0.1',
	]);
	runChecked(openssl, [
		'x509',
		'-req',
		'-in',
		srvCsr,
		'-CA',
		caCert,
		'-CAkey',
		caKey,
		'-CAcreateserial',
		'-out',
		srvCert,
		'-days',
		'2',
		'-extfile',
		srvExt,
	]);

	return {
		caCertPath: caCert,
		serverKey: readFileSync(srvKey),
		serverCert: readFileSync(srvCert),
	};
}

function buildUpdaterTestBinary(): string {
	const raw = runChecked(
		'cargo',
		['test', '--locked', '--test', 'updater', '--no-run', '--message-format=json'],
		{ cwd: SRC_TAURI }
	);
	let executable: string | undefined;
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		const parsed = JSON.parse(line) as {
			reason?: string;
			target?: { name?: string; kind?: string[] };
			executable?: string | null;
		};
		if (
			parsed.reason === 'compiler-artifact' &&
			parsed.target?.name === 'updater' &&
			parsed.executable
		) {
			executable = parsed.executable;
		}
	}
	if (!executable || !existsSync(executable)) {
		throw new Error('Could not locate compiled `updater` test binary from cargo output');
	}
	return executable;
}

const TAURI_CLI = join(PACKAGE, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/** #2808: the notice files `build-notices.mjs` writes and `tauri build` bundles beside the app. */
const NOTICES = join(PACKAGE, 'dist-notices');
const NOTICE_FILES = ['THIRD_PARTY_NOTICES.txt', 'RUST_STANDARD_LIBRARY_NOTICES.html'];

/**
 * Every file under `dir` named `name`, never through a symbolic link: a disk image's `Applications` link points at
 * the machine's own `/Applications`, which `readdirSync`'s `recursive` follows (into Xcode, past `ENAMETOOLONG`).
 */
function filesNamed(dir: string, name: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) found.push(...filesNamed(path, name));
		else if (entry.name === name) found.push(path);
	}
	return found;
}

/**
 * Unpacks an installer's files into a fresh directory, without installing it: `dpkg-deb -x`, the AppImage's own
 * `--appimage-extract`, `tar`, a read-only `hdiutil` mount, or an MSI administrative install (`msiexec /a`).
 * Returns the directory to search and a cleanup for a mount.
 */
function unpackInstaller(name: string): { dir: string; done: () => void } {
	const installer = join(OUT, name);
	const dir = makeTempDir('loam-p6-d5-unpack-');
	if (name.endsWith('.deb')) {
		runChecked('dpkg-deb', ['-x', installer, dir]);
	} else if (name.endsWith('.AppImage')) {
		const copy = join(dir, name);
		copyFileSync(installer, copy);
		chmodSync(copy, 0o755);
		const env = { ...process.env };
		delete env.APPIMAGE_EXTRACT_AND_RUN;
		runChecked(copy, ['--appimage-extract'], { cwd: dir, env });
		rmSync(copy, { force: true });
	} else if (name.endsWith('.tar.gz')) {
		runChecked('tar', ['-xzf', installer, '-C', dir]);
	} else if (name.endsWith('.dmg')) {
		const mount = join(dir, 'mount');
		mkdirSync(mount);
		runChecked('hdiutil', [
			'attach',
			'-nobrowse',
			'-readonly',
			'-noautoopen',
			'-mountpoint',
			mount,
			installer,
		]);
		return { dir: mount, done: () => runChecked('hdiutil', ['detach', mount, '-force']) };
	} else if (name.endsWith('.msi')) {
		runChecked('msiexec', ['/a', installer, '/qn', `TARGETDIR=${dir}`]);
	} else {
		throw new Error(`No way to unpack ${name}`);
	}
	return { dir, done: () => {} };
}

function generateMinisignKeypair(dir: string, name: string): { keyPath: string; pubkey: string } {
	const keyPath = join(dir, `${name}.key`);
	runChecked(
		process.execPath,
		[TAURI_CLI, 'signer', 'generate', '--ci', '--force', '-w', keyPath],
		{
			cwd: PACKAGE,
			env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' },
		}
	);
	const pubkey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
	return { keyPath, pubkey };
}

function signArtifact(keyPath: string, artifactPath: string, appVersion = '0.2.0'): string {
	runChecked(
		process.execPath,
		[TAURI_CLI, 'signer', 'sign', '-f', keyPath, '--app-version', appVersion, artifactPath],
		{
			cwd: PACKAGE,
			env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' },
		}
	);
	const sigPath = `${artifactPath}.sig`;
	const signature = readFileSync(sigPath, 'utf8').trim();
	rmSync(sigPath, { force: true });
	return signature;
}

function updaterPlatformKey(): string {
	const os =
		process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
	const arch =
		process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
	return `${os}-${arch}`;
}

async function waitForFileContent(path: string, timeoutMs = 15_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			const content = readFileSync(path, 'utf8');
			if (content.length > 0) return content;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for marker file: ${path}`);
}

describe('P6-D5: installers and updates', () => {
	it('P6-D5: builds unsigned installers for this platform, verifies SHA-256 sums and records sizes', () => {
		expect(existsSync(OUT), `${OUT} missing; run build:installers first`).toBe(true);
		const sumsPath = join(OUT, 'SHA256SUMS.txt');
		expect(existsSync(sumsPath)).toBe(true);

		const expectedSuffixes: Record<string, string[]> = {
			linux: ['.deb', '.AppImage'],
			win32: ['.msi'],
			darwin: ['.app.tar.gz', '.dmg'],
		};
		const required = expectedSuffixes[process.platform];
		if (!required) {
			throw new Error(`Unsupported platform: ${process.platform}`);
		}

		const tauriConf = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8')) as {
			version: string;
		};
		const files = readdirSync(OUT)
			.filter((name) => name !== 'SHA256SUMS.txt')
			.sort();
		expect(
			files.length,
			`expected exactly ${required.length} installer(s) for ${process.platform}, found: ${files.join(', ')}`
		).toBe(required.length);
		for (const suffix of required) {
			const matches = files.filter(
				(name) => name.endsWith(suffix) && name.includes(tauriConf.version)
			);
			expect(
				matches.length,
				`expected exactly 1 ${suffix} installer for version ${tauriConf.version} in ${OUT}, found: ${files.join(', ')}`
			).toBe(1);
		}

		const sumsLines = readFileSync(sumsPath, 'utf8')
			.trim()
			.split('\n')
			.map((line) => {
				const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
				expect(match, `malformed SHA256SUMS line: ${line}`).not.toBeNull();
				return { sha256: match?.[1] ?? '', name: match?.[2] ?? '' };
			});
		expect(sumsLines.map((entry) => entry.name)).toEqual(files);

		const recorded = JSON.parse(
			readFileSync(join(RESULTS, `installers-${process.platform}.json`), 'utf8')
		) as {
			platform: string;
			signed: boolean;
			installers: { name: string; sizeBytes: number; sha256: string }[];
		};
		expect(recorded.platform).toBe(process.platform);
		expect(recorded.signed).toBe(false);
		expect(recorded.installers.map((entry) => entry.name)).toEqual(files);

		for (const entry of sumsLines) {
			const filePath = join(OUT, entry.name);
			const size = statSync(filePath).size;
			expect(size, `${entry.name} must be a real installer`).toBeGreaterThan(100_000);
			const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
			expect(digest, `${entry.name} SHA-256 mismatch`).toBe(entry.sha256);
			const row = recorded.installers.find((item) => item.name === entry.name);
			expect(row).toEqual({ name: entry.name, sizeBytes: size, sha256: digest });
			process.stderr.write(
				`P6-D5 installer (${process.platform}): ${entry.name} = ${size} bytes (${(size / (1024 * 1024)).toFixed(2)} MiB)\n`
			);
		}
	});

	it('#2808: every installer carries the third-party notices beside the app', () => {
		const expected = NOTICE_FILES.map((file) => {
			const path = join(NOTICES, file);
			expect(existsSync(path), `${path} missing; build:installers writes it`).toBe(true);
			return { file, bytes: readFileSync(path) };
		});
		// The polyfill the binary embeds, and entries only the builds' module records give: a crate, a bundled npm
		// package, FAST-AF's Microsoft notice and the fonts' OFL.
		const notices = expected[0]?.bytes.toString('utf8') ?? '';
		for (const entry of [
			/^@webcomponents\/scoped-custom-element-registry 0\.0\.10$/m,
			/^tauri \d+\.\d+\.\d+$/m,
			/^zod \d+\.\d+\.\d+$/m,
			/^@lushly-dev\/fast-element .*\n(?: {2}.*\n)*? {2}\[\d+\] foundations\/fast-af\/packages\/element\/LICENSE$/m,
			/^@lushly-dev\/loam-theme .*\n(?: {2}.*\n)*? {2}\[\d+\] endpoints\/loam\/packages\/theme\/fonts\/OFL-Inter\.txt$/m,
		])
			expect(notices).toMatch(entry);
		const installers = readdirSync(OUT).filter((name) => name !== 'SHA256SUMS.txt');
		expect(installers.length).toBeGreaterThan(0);
		for (const name of installers) {
			const { dir, done } = unpackInstaller(name);
			try {
				for (const { file, bytes } of expected) {
					const found = filesNamed(dir, file);
					expect(found, `${name} must carry ${file} once`).toHaveLength(1);
					const [path = ''] = found;
					expect(readFileSync(path).equals(bytes), `${name}: ${file} differs from ${NOTICES}`).toBe(
						true
					);
					process.stderr.write(`#2808 ${name}: ${path.slice(dir.length + 1)}\n`);
				}
			} finally {
				done();
			}
		}
	});

	it('P6-D5: without a key, no update request is made', async () => {
		const dir = makeTempDir('loam-p6-d5-nokey-');
		const tls = generateTestCaAndServerCert(dir);
		const updaterBin = buildUpdaterTestBinary();

		let connections = 0;
		const requests: string[] = [];
		const server = createHttpsServer({ key: tls.serverKey, cert: tls.serverCert }, (req, res) => {
			requests.push(`${req.method} ${req.url}`);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{}');
		});
		server.on('connection', () => {
			connections += 1;
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;

		try {
			const cleanEnv = { ...process.env };
			delete cleanEnv.LOAM_P6_D5_PUBKEY;
			await runCheckedAsync(updaterBin, [], {
				env: {
					...cleanEnv,
					LOAM_P6_D5_MODE: 'disabled',
					LOAM_P6_D5_ENDPOINT: `https://127.0.0.1:${port}/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				},
			});
			expect(connections).toBe(0);
			expect(requests).toEqual([]);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('P6-D5: with a test key, a signed HTTPS update with a test CA installs, and tampered, wrong-key, untrusted-CA and plain-HTTP updates are refused', async () => {
		const dir = makeTempDir('loam-p6-d5-https-');
		const tls = generateTestCaAndServerCert(dir);
		const updaterBin = buildUpdaterTestBinary();
		const goodKey = generateMinisignKeypair(dir, 'good');
		const wrongKey = generateMinisignKeypair(dir, 'wrong');

		// Prepare a platform-valid update payload and target installation path.
		let payloadPath = '';
		let targetExecutable = '';
		let verifyInstalled: () => Promise<void>;
		let verifyUntouched: () => void;
		const installMarkerPath = join(dir, 'windows-install-marker.txt');

		if (process.platform === 'win32') {
			// Copy the compiled `updater` test PE executable (which embeds our `asInvoker` manifest)
			// as the signed update payload. When `tauri-plugin-updater` installs it via
			// `ShellExecuteW`, it passes `/P /UPDATE` and writes `installMarkerPath`.
			payloadPath = join(dir, 'Loam_0.2.0_x64-setup.exe');
			copyFileSync(updaterBin, payloadPath);
			targetExecutable = join(dir, 'current', 'loam-desktop.exe');
			mkdirSync(join(dir, 'current'), { recursive: true });
			writeFileSync(targetExecutable, 'OLD_0.1.0');
			verifyUntouched = () => {
				expect(readFileSync(targetExecutable, 'utf8')).toBe('OLD_0.1.0');
				expect(existsSync(installMarkerPath)).toBe(false);
			};
			verifyInstalled = async () => {
				const marker = await waitForFileContent(installMarkerPath, 15_000);
				expect(marker).toContain('installed=0.2.0');
				expect(marker).toMatch(/\/UPDATE/i);
				expect(readFileSync(targetExecutable, 'utf8')).toBe('LOAM_UPDATED_0.2.0\n');
			};
		} else if (process.platform === 'linux') {
			// A minimal valid ELF payload for `install_appimage`: ELF magic + marker bytes.
			const oldElf = Buffer.concat([
				Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
				Buffer.alloc(56, 0),
				Buffer.from('LOAM_OLD_0.1.0\n'),
			]);
			const newElf = Buffer.concat([
				Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
				Buffer.alloc(56, 0),
				Buffer.from('LOAM_UPDATED_0.2.0\n'),
			]);
			targetExecutable = join(dir, 'Loam.AppImage');
			writeFileSync(targetExecutable, oldElf);
			chmodSync(targetExecutable, 0o755);
			payloadPath = join(dir, 'Loam_0.2.0_amd64.AppImage');
			writeFileSync(payloadPath, newElf);
			verifyUntouched = () => {
				expect(readFileSync(targetExecutable).equals(oldElf)).toBe(true);
			};
			verifyInstalled = async () => {
				expect(readFileSync(targetExecutable).equals(newElf)).toBe(true);
			};
		} else if (process.platform === 'darwin') {
			// Existing `.app` bundle + signed `.app.tar.gz` replacement bundle.
			const currentApp = join(dir, 'Loam.app');
			mkdirSync(join(currentApp, 'Contents', 'MacOS'), { recursive: true });
			targetExecutable = join(currentApp, 'Contents', 'MacOS', 'loam-desktop');
			writeFileSync(targetExecutable, 'LOAM_OLD_0.1.0\n');
			chmodSync(targetExecutable, 0o755);

			const stage = join(dir, 'stage');
			mkdirSync(join(stage, 'Loam.app', 'Contents', 'MacOS'), { recursive: true });
			writeFileSync(
				join(stage, 'Loam.app', 'Contents', 'MacOS', 'loam-desktop'),
				'LOAM_UPDATED_0.2.0\n'
			);
			chmodSync(join(stage, 'Loam.app', 'Contents', 'MacOS', 'loam-desktop'), 0o755);
			payloadPath = join(dir, 'Loam_0.2.0_aarch64.app.tar.gz');
			runChecked('tar', ['-czf', payloadPath, '-C', stage, 'Loam.app']);

			verifyUntouched = () => {
				expect(readFileSync(targetExecutable, 'utf8')).toBe('LOAM_OLD_0.1.0\n');
			};
			verifyInstalled = async () => {
				expect(readFileSync(targetExecutable, 'utf8')).toBe('LOAM_UPDATED_0.2.0\n');
			};
		} else {
			throw new Error(`Unsupported platform: ${process.platform}`);
		}

		const goodBytes = readFileSync(payloadPath);
		const tamperedBytes = Buffer.from(goodBytes);
		// Flip a byte near the end so header magic stays valid and signature verification is what catches it.
		const lastIndex = tamperedBytes.length - 1;
		tamperedBytes[lastIndex] = (tamperedBytes[lastIndex] ?? 0) ^ 0xff;

		const goodSig = signArtifact(goodKey.keyPath, payloadPath, '0.2.0');
		const wrongKeySig = signArtifact(wrongKey.keyPath, payloadPath, '0.2.0');
		const wrongVersionSig = signArtifact(goodKey.keyPath, payloadPath, '0.1.5');
		const platformKey = updaterPlatformKey();

		// Separate plaintext HTTP listener so any downgrade redirect (or plain-HTTP request) that
		// bypassed our HTTPS-only policy would actually connect and be counted.
		let plainHttpConnections = 0;
		const plainHttpRequests: string[] = [];
		const plainHttpServer = createHttpServer((req, res) => {
			plainHttpRequests.push(`${req.method} ${req.url}`);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{}');
		});
		plainHttpServer.on('connection', () => {
			plainHttpConnections += 1;
		});
		await new Promise<void>((resolve) => plainHttpServer.listen(0, '127.0.0.1', resolve));
		const { port: plainHttpPort } = plainHttpServer.address() as AddressInfo;

		const requests: string[] = [];
		const server = createHttpsServer({ key: tls.serverKey, cert: tls.serverCert }, (req, res) => {
			requests.push(`${req.method} ${req.url}`);
			const { port } = server.address() as AddressInfo;
			const base = `https://127.0.0.1:${port}`;
			const manifest = (url: string, signature: string) =>
				JSON.stringify({
					version: '0.2.0',
					notes: 'P6-D5 test release',
					platforms: {
						[platformKey]: { url, signature },
					},
				});

			if (req.url === '/good/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`${base}/good/artifact`, goodSig));
			} else if (req.url === '/tampered/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`${base}/tampered/artifact`, goodSig));
			} else if (req.url === '/wrong-key/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`${base}/good/artifact`, wrongKeySig));
			} else if (req.url === '/wrong-version/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`${base}/good/artifact`, wrongVersionSig));
			} else if (req.url === '/http-download/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`http://127.0.0.1:${plainHttpPort}/good/artifact`, goodSig));
			} else if (req.url === '/http-redirect/latest.json') {
				res.writeHead(302, {
					location: `http://127.0.0.1:${plainHttpPort}/good/latest.json`,
				});
				res.end();
			} else if (req.url === '/http-artifact-redirect/latest.json') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(manifest(`${base}/http-artifact-redirect/artifact`, goodSig));
			} else if (req.url === '/http-artifact-redirect/artifact') {
				res.writeHead(302, {
					location: `http://127.0.0.1:${plainHttpPort}/good/artifact`,
				});
				res.end();
			} else if (req.url === '/good/artifact') {
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				res.end(goodBytes);
			} else if (req.url === '/tampered/artifact') {
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				res.end(tamperedBytes);
			} else {
				res.writeHead(404);
				res.end('not found');
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		const base = `https://127.0.0.1:${port}`;

		const baseEnv = (extra: Record<string, string | undefined>) => {
			const env: NodeJS.ProcessEnv = {
				...process.env,
				LOAM_P6_D5_PUBKEY: goodKey.pubkey,
				LOAM_P6_D5_TARGET_PATH: targetExecutable,
				LOAM_P6_D5_TARGET: platformKey,
				LOAM_P6_D5_INSTALLER_MARKER: installMarkerPath,
			};
			for (const [key, value] of Object.entries(extra)) {
				if (value === undefined) delete env[key];
				else env[key] = value;
			}
			return env;
		};

		try {
			// 1. Plain HTTP endpoint is refused at config validation (never contacts server).
			const httpEndpointOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `http://127.0.0.1:${plainHttpPort}/good/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(httpEndpointOut).toContain('refused: updater endpoint must use https');
			expect(plainHttpConnections).toBe(0);
			verifyUntouched();

			// 2. Manifest pointing to a plain HTTP download URL is refused before downloading.
			const httpDownloadOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/http-download/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(httpDownloadOut).toContain('refused: updater download URL must use https');
			expect(plainHttpConnections).toBe(0);
			verifyUntouched();

			// 2b. HTTPS feed redirecting to plain HTTP is refused by the redirect policy (zero
			// plaintext TCP connections).
			const httpRedirectOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/http-redirect/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(httpRedirectOut).toContain('updater redirect URL must use https');
			expect(plainHttpConnections).toBe(0);
			expect(plainHttpRequests).toEqual([]);
			verifyUntouched();

			// 2c. HTTPS artifact download redirecting to plain HTTP is also refused by the redirect
			// policy (zero plaintext TCP connections).
			const httpArtifactRedirectOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/http-artifact-redirect/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(httpArtifactRedirectOut).toContain('updater redirect URL must use https');
			expect(plainHttpConnections).toBe(0);
			expect(plainHttpRequests).toEqual([]);
			verifyUntouched();

			// 3. Untrusted CA (no test CA supplied) is refused by TLS verification before any HTTP
			// request reaches the feed handler.
			const untrustedCaOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/good/latest.json`,
					LOAM_P6_D5_CA_PATH: undefined,
				}),
			});
			expect(untrustedCaOut).toMatch(
				/refused:.*(certificate|tls|issuer|handshake|error sending request)/i
			);
			expect(requests).not.toContain('GET /good/latest.json');
			verifyUntouched();

			// 4. Tampered artifact (1 byte flipped) is refused by minisign verification.
			const tamperedOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/tampered/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(tamperedOut).toMatch(/refused:.*signature/i);
			expect(requests).toContain('GET /tampered/artifact');
			verifyUntouched();

			// 5. Artifact signed with a different key is refused by minisign verification.
			const wrongKeyOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/wrong-key/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(wrongKeyOut).toMatch(/refused:.*signature/i);
			verifyUntouched();

			// 5b. Valid signature bound to a different app version is refused (`requireSignedVersion`).
			const wrongVersionOut = await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'refuse',
					LOAM_P6_D5_ENDPOINT: `${base}/wrong-version/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(wrongVersionOut).toMatch(/refused:.*version/i);
			verifyUntouched();

			// 6. Valid signed update over HTTPS with the test CA downloads, verifies and installs.
			await runCheckedAsync(updaterBin, [], {
				env: baseEnv({
					LOAM_P6_D5_MODE: 'install',
					LOAM_P6_D5_ENDPOINT: `${base}/good/latest.json`,
					LOAM_P6_D5_CA_PATH: tls.caCertPath,
				}),
			});
			expect(requests).toContain('GET /good/latest.json');
			expect(requests).toContain('GET /good/artifact');
			expect(plainHttpConnections).toBe(0);
			await verifyInstalled();
		} finally {
			await Promise.all([
				new Promise<void>((resolve) => server.close(() => resolve())),
				new Promise<void>((resolve) => plainHttpServer.close(() => resolve())),
			]);
		}
	});
});
