#!/usr/bin/env node
/**
 * Stages a release build of `specimen-host` into its prebuilt platform package
 * (`packages/host-<platform>/bin/specimen-host`), or checks one already staged.
 *
 * Usage: node host/stage.mjs [<platform>] [--binary <path>]
 *        node host/stage.mjs --check <platform>
 *
 * The platform defaults to this machine's; the binary defaults to `host/target/release`. Both
 * forms read the binary's header and refuse one built for another system or architecture, so a
 * host built elsewhere (a CI artifact) can be staged but never into the wrong package. Each
 * platform package's `prepack` runs the check, so an unstaged package cannot be packed.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specimen = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
	console.error(`specimen-host stage: ${message}`);
	process.exit(1);
};
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Every platform package, keyed by its suffix, with the system and architecture it declares. */
const packages = new Map(
	readdirSync(join(specimen, 'packages'))
		.filter((name) => name.startsWith('host-'))
		.map((name) => {
			const manifest = read(join(specimen, 'packages', name, 'package.json'));
			return [
				name.slice('host-'.length),
				{ directory: join(specimen, 'packages', name), manifest },
			];
		})
);

// Mach-O 64-bit (little-endian) and ELF CPU identifiers for the architectures Node names.
const MACHO = { x64: 0x01000007, arm64: 0x0100000c };
const ELF = { x64: 0x3e, arm64: 0xb7 };

/** The system and architecture a binary was built for, from its header. */
function binaryTarget(path) {
	const header = readFileSync(path).subarray(0, 20);
	if (header.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf) {
		const cpu = header.readUInt32LE(4);
		return { os: 'darwin', cpu: Object.keys(MACHO).find((key) => MACHO[key] === cpu) };
	}
	if (header.length >= 20 && header.readUInt32BE(0) === 0x7f454c46) {
		const machine = header.readUInt16LE(18);
		return { os: 'linux', cpu: Object.keys(ELF).find((key) => ELF[key] === machine) };
	}
	return { os: undefined, cpu: undefined };
}

function verify(platform, path) {
	const entry = packages.get(platform);
	if (!entry)
		fail(`no platform package for ${platform}; known: ${[...packages.keys()].join(', ')}`);
	const version = read(join(specimen, 'package.json')).version;
	if (entry.manifest.version !== version)
		fail(`${entry.manifest.name} is ${entry.manifest.version}, Specimen is ${version}`);
	if (!existsSync(path)) fail(`no host binary at ${path}`);
	const target = binaryTarget(path);
	const [os] = entry.manifest.os;
	const [cpu] = entry.manifest.cpu;
	if (target.os !== os || target.cpu !== cpu)
		fail(
			`${path} is built for ${target.os ?? 'an unknown system'}-${target.cpu ?? 'unknown'}, not ${os}-${cpu}`
		);
	return entry;
}

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const [value] = args.splice(index, 2).slice(1);
	if (!value) fail(`${name} needs a value`);
	return value;
};
const check = option('--check');
if (check) {
	const path = join(specimen, 'packages', `host-${check}`, 'bin', 'specimen-host');
	const entry = verify(check, path);
	if (!(readFileSync(path).length > 0)) fail(`${path} is empty`);
	console.log(`ok - ${entry.manifest.name} carries a ${check} host`);
} else {
	const binary = resolve(option('--binary') ?? join(specimen, 'host/target/release/specimen-host'));
	const libc = process.platform === 'linux' ? '-gnu' : '';
	const platform = args[0] ?? `${process.platform}-${process.arch}${libc}`;
	if (args.length > 1) fail(`unexpected arguments: ${args.slice(1).join(' ')}`);
	const entry = verify(platform, binary);
	const target = join(entry.directory, 'bin', 'specimen-host');
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(binary, target);
	chmodSync(target, 0o755);
	console.log(`staged ${binary} into ${entry.manifest.name}`);
}
