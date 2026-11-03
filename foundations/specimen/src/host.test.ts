import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostBinaryPath, hostPackageName } from './host.js';

const specimen = join(import.meta.dirname, '..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('prebuilt host packages', () => {
	it('names one package per supported system and architecture, and none elsewhere', () => {
		expect(hostPackageName('darwin', 'arm64')).toBe('@lushly-dev/specimen-host-darwin-arm64');
		expect(hostPackageName('darwin', 'x64')).toBe('@lushly-dev/specimen-host-darwin-x64');
		expect(hostPackageName('linux', 'x64')).toBe('@lushly-dev/specimen-host-linux-x64-gnu');
		expect(hostPackageName('linux', 'arm64')).toBe('@lushly-dev/specimen-host-linux-arm64-gnu');
		expect(hostPackageName('win32', 'x64')).toBeUndefined();
		expect(hostPackageName('linux', 'ia32')).toBeUndefined();
	});

	it('declares every platform package at Specimen’s version, as an optional dependency', () => {
		const manifest = read(join(specimen, 'package.json'));
		const packages = readdirSync(join(specimen, 'packages'))
			.filter((name) => name.startsWith('host-'))
			.map((name) => read(join(specimen, 'packages', name, 'package.json')));
		expect(packages).toHaveLength(4);
		for (const host of packages) {
			expect(hostPackageName(host.os[0], host.cpu[0])).toBe(host.name);
			expect(host.version).toBe(manifest.version);
			expect(host.files).toContain('bin/specimen-host');
			// Packing keeps a file executable only when it is a declared bin.
			expect(host.bin).toEqual({ 'specimen-host': 'bin/specimen-host' });
			expect(host.libc).toEqual(host.os[0] === 'linux' ? ['glibc'] : undefined);
		}
		expect(manifest.optionalDependencies).toEqual(
			Object.fromEntries(packages.map((host) => [host.name, 'workspace:*']).sort())
		);
	});
});

describe('hostBinaryPath', () => {
	let root: string;
	// An installed layout: the package's dist beside node_modules, with no source build.
	let moduleUrl: string;
	const name = hostPackageName();
	const install = (binary: boolean) => {
		if (!name) return;
		const directory = join(root, 'node_modules', name);
		mkdirSync(join(directory, 'bin'), { recursive: true });
		writeFileSync(join(directory, 'package.json'), JSON.stringify({ name }));
		if (binary) writeFileSync(join(directory, 'bin', 'specimen-host'), 'host');
		return join(directory, 'bin', 'specimen-host');
	};

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'specimen-host-'));
		mkdirSync(join(root, 'node_modules', '@lushly-dev', 'specimen', 'dist'), { recursive: true });
		moduleUrl = pathToFileURL(
			join(root, 'node_modules', '@lushly-dev', 'specimen', 'dist', 'host.js')
		).href;
		vi.stubEnv('SPECIMEN_HOST_BINARY', '');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	});

	it('uses SPECIMEN_HOST_BINARY first, and fails when it points nowhere', () => {
		const binary = join(root, 'custom-host');
		writeFileSync(binary, 'host');
		install(true);
		vi.stubEnv('SPECIMEN_HOST_BINARY', binary);
		expect(hostBinaryPath(moduleUrl)).toBe(binary);
		vi.stubEnv('SPECIMEN_HOST_BINARY', join(root, 'missing'));
		expect(() => hostBinaryPath(moduleUrl)).toThrow(/where SPECIMEN_HOST_BINARY points/);
	});

	it('prefers a source build beside the package to an installed platform package', () => {
		install(true);
		const built = join(root, 'node_modules', '@lushly-dev', 'specimen', 'host/target/release');
		mkdirSync(built, { recursive: true });
		writeFileSync(join(built, 'specimen-host'), 'host');
		expect(hostBinaryPath(moduleUrl)).toBe(join(built, 'specimen-host'));
	});

	it.runIf(name)('finds the installed platform package’s binary', () => {
		const binary = install(true) as string;
		expect(hostBinaryPath(moduleUrl)).toBe(realpathSync(binary));
	});

	// An uninstalled package is checked by the packed consumers: under `pnpm exec`, NODE_PATH
	// reaches the workspace's own platform packages from any directory.
	it.runIf(name)('names the package when its binary is missing', () => {
		install(false);
		expect(() => hostBinaryPath(moduleUrl)).toThrow(`${name} has no host binary`);
	});
});
