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
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chromiumExecutable,
	hostBinaryName,
	hostBinaryPath,
	hostError,
	hostPackageName,
	type SpecimenHostError,
} from './host.js';

const specimen = join(import.meta.dirname, '..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('prebuilt host packages', () => {
	it('names one package per supported system and architecture, and none elsewhere', () => {
		expect(hostPackageName('darwin', 'arm64')).toBe('@lushly-dev/specimen-host-darwin-arm64');
		expect(hostPackageName('darwin', 'x64')).toBe('@lushly-dev/specimen-host-darwin-x64');
		expect(hostPackageName('linux', 'x64')).toBe('@lushly-dev/specimen-host-linux-x64-gnu');
		expect(hostPackageName('linux', 'arm64')).toBe('@lushly-dev/specimen-host-linux-arm64-gnu');
		expect(hostPackageName('win32', 'x64')).toBe('@lushly-dev/specimen-host-win32-x64');
		expect(hostPackageName('win32', 'arm64')).toBeUndefined();
		expect(hostPackageName('linux', 'ia32')).toBeUndefined();
	});

	it('declares every platform package at Specimen’s version, as an optional dependency', () => {
		const manifest = read(join(specimen, 'package.json'));
		const packages = readdirSync(join(specimen, 'packages'))
			.filter((name) => name.startsWith('host-'))
			.map((name) => read(join(specimen, 'packages', name, 'package.json')));
		expect(packages).toHaveLength(5);
		for (const host of packages) {
			const binary = `bin/${hostBinaryName(host.os[0])}`;
			expect(hostPackageName(host.os[0], host.cpu[0])).toBe(host.name);
			expect(host.version).toBe(manifest.version);
			expect(host.files).toContain(binary);
			// Packing keeps a file executable only when it is a declared bin. It is declared for
			// publication alone: the binary does not exist at install, so a top-level bin makes pnpm
			// warn in every source checkout.
			expect(host.bin).toBeUndefined();
			expect(host.publishConfig.bin).toEqual({ 'specimen-host': binary });
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
		if (binary) writeFileSync(join(directory, 'bin', hostBinaryName()), 'host');
		return join(directory, 'bin', hostBinaryName());
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
		writeFileSync(join(built, hostBinaryName()), 'host');
		expect(hostBinaryPath(moduleUrl)).toBe(join(built, hostBinaryName()));
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

describe('the Chromium headless shell', () => {
	const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
	afterEach(() => {
		if (configured === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
		else process.env.PLAYWRIGHT_BROWSERS_PATH = configured;
	});

	// Where no native host is built, the lookup stops before the shell's path.
	it.runIf(hostPackageName() === undefined)(
		'names a system the native host does not support',
		() => {
			expect(() => chromiumExecutable()).toThrow(
				`Specimen's native host does not support ${process.platform}-${process.arch}`
			);
		}
	);

	it.runIf(hostPackageName() !== undefined)(
		'names the Playwright version it needs and a command any project can run',
		() => {
			const empty = mkdtempSync(join(tmpdir(), 'specimen-no-browsers-'));
			process.env.PLAYWRIGHT_BROWSERS_PATH = empty;
			const { version } = read(join(specimen, 'node_modules/playwright/package.json'));
			try {
				expect(() => chromiumExecutable()).toThrow(
					`for Playwright ${version}, is missing at ${empty}${sep}`
				);
				expect(() => chromiumExecutable()).toThrow(
					`install it with \`npx playwright@${version} install --only-shell chromium\``
				);
			} finally {
				rmSync(empty, { recursive: true, force: true });
			}
		}
	);
});

describe('hostError', () => {
	it('preserves structured code, suggestion, and details from typed host errors', () => {
		const notFound = hostError({
			message: 'Target \'print\' (role "button", name "Print") matched no elements',
			causes: [],
			code: 'TARGET_NOT_FOUND',
			suggestion: 'Point again in the review page, or name a role and name that exist.',
			details: { count: 0, target: 'print' },
		});
		expect(notFound).toBeInstanceOf(Error);
		expect(notFound.code).toBe('TARGET_NOT_FOUND');
		expect(notFound.suggestion).toContain('review page');
		expect(notFound.details).toEqual({ count: 0, target: 'print' });

		const ambiguous = hostError({
			message: 'Target \'action\' (role "button") matched 2 elements; expected 1',
			causes: [],
			code: 'TARGET_AMBIGUOUS',
			suggestion:
				'Matched 2 elements; add a name, narrow the selector, or point in the review page.',
			details: { count: 2, target: 'action' },
		});
		expect(ambiguous.code).toBe('TARGET_AMBIGUOUS');
		expect(ambiguous.details).toEqual({ count: 2, target: 'action' });
	});

	it('keeps render metadata on both the AggregateError and its primary cause', () => {
		const combined = hostError({
			message: 'Specimen render and disposal failed: missing; cleanup',
			causes: ['Target \'missing\' (selector ".missing") matched no elements', 'cleanup'],
			code: 'TARGET_NOT_FOUND',
			suggestion: 'Point again in the review page, or name a role and name that exist.',
			details: { count: 0, target: 'missing' },
		}) as AggregateError & SpecimenHostError;
		expect(combined).toBeInstanceOf(AggregateError);
		expect(combined.code).toBe('TARGET_NOT_FOUND');
		expect(combined.details).toEqual({ count: 0, target: 'missing' });
		expect(combined.errors[0]).toMatchObject({
			code: 'TARGET_NOT_FOUND',
			suggestion: 'Point again in the review page, or name a role and name that exist.',
			details: { count: 0, target: 'missing' },
		});
		expect((combined.errors[1] as SpecimenHostError).code).toBeUndefined();
	});

	it('leaves untyped host failures and blank or unencodable fields cleanly omitted', () => {
		const plain = hostError({
			message: 'plain failure',
			causes: [],
			code: '   ',
			suggestion: '\t\n',
			details: { attempts: 1n },
		});
		expect(plain.message).toBe('plain failure');
		expect(plain.code).toBeUndefined();
		expect(plain.suggestion).toBeUndefined();
		expect(plain.details).toBeUndefined();
	});
});
