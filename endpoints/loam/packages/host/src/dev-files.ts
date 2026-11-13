/**
 * @fileoverview The development profile's own files (phase 6 specification, 5.1): its certificate and
 * key, its generated auth secret (section 13's one exception), its mail sink and `dev.json`'s ports. Every
 * file is 0600 and every directory 0700, and the data directory holds a `.gitignore` of `*`.
 */

import { execFile } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HostError } from './errors.js';

export const DEV_FILE = 'dev.json';
export const MAIL_FILE = 'mail.jsonl';
export const TLS_DIRECTORY = 'tls';
export const SECRETS_DIRECTORY = 'secrets';

/** A private file, written whole: removed first, since a mode applies only when a file is created. */
export async function writePrivate(path: string, contents: string | Buffer): Promise<void> {
	await rm(path, { force: true });
	await writeFile(path, contents, { mode: 0o600, flag: 'wx' });
}

/** A private directory, created 0700, or made 0700 if it is this profile's and exists. */
export async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
}

/** The `.gitignore` the profile writes in its data directory. */
export const DEV_GITIGNORE = '*\n';

/**
 * Takes the data directory for the profile, which then makes it 0700 and writes in it: only one that is
 * missing, empty, or already the profile's (it holds `dev.json`, or a `.gitignore` of exactly `*`), so a
 * mistyped `--data` never re-modes or writes into a directory of someone else's.
 */
export async function claimDataDirectory(path: string): Promise<void> {
	const refuse = (why: string) =>
		new HostError([
			{
				code: 'HOST_CONFIG_INVALID',
				key: path,
				message: `\`--data\` names ${why}, which the development profile did not make.`,
				suggestion:
					"Name a missing or empty directory, or the profile's own; `.loam-dev/` beside the deployment file is the default.",
			},
		]);
	if (existsSync(path)) {
		if (!statSync(path).isDirectory()) throw refuse('a file');
		const entries = readdirSync(path);
		const ours =
			entries.length === 0 ||
			entries.includes(DEV_FILE) ||
			(entries.includes('.gitignore') &&
				readFileSync(join(path, '.gitignore'), 'utf8').replace(/\r?\n$/, '') === '*');
		if (!ours) throw refuse('a directory that holds other files');
	}
	await privateDirectory(path);
}

export interface DevCertificate {
	certificate: string;
	key: string;
	/** The base64 SHA-256 of the certificate's public key, for `--ignore-certificate-errors-spki-list`. */
	spki: string;
}

/** The base64 SHA-256 of a certificate's SubjectPublicKeyInfo. */
export function spkiOf(certificatePem: string | Buffer): string {
	const der = createPublicKey(certificatePem).export({ type: 'spki', format: 'der' });
	return createHash('sha256').update(der).digest('base64');
}

/**
 * The certificate for `localhost` and `127.0.0.1`, made by 5.1's command on the first run and reused
 * until it expires.
 */
export async function ensureCertificate(data: string): Promise<DevCertificate> {
	const directory = join(data, TLS_DIRECTORY);
	await privateDirectory(directory);
	const certificate = join(directory, 'cert.pem');
	const key = join(directory, 'key.pem');
	const valid = (() => {
		if (!existsSync(certificate) || !existsSync(key)) return false;
		try {
			return new Date(new X509Certificate(readFileSync(certificate)).validTo) > new Date();
		} catch {
			return false;
		}
	})();
	if (!valid) {
		await rm(certificate, { force: true });
		await rm(key, { force: true });
		await makeCertificate(certificate, key);
	}
	await chmod(certificate, 0o600);
	await chmod(key, 0o600);
	return { certificate, key, spki: spkiOf(await readFile(certificate)) };
}

/** 5.1's command; a missing or failing `openssl` is a finding that names it. */
async function makeCertificate(certificate: string, key: string): Promise<void> {
	try {
		await promisify(execFile)(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'ec',
				'-pkeyopt',
				'ec_paramgen_curve:P-256',
				'-nodes',
				'-keyout',
				key,
				'-out',
				certificate,
				'-days',
				'30',
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost,IP:127.0.0.1',
			],
			{ timeout: 30_000 }
		);
	} catch (cause) {
		const missing = (cause as NodeJS.ErrnoException).code === 'ENOENT';
		throw new HostError([
			{
				code: 'HOST_CONFIG_INVALID',
				key: 'openssl',
				message: missing
					? '`openssl` is not on `PATH`; the development profile makes its certificate with it.'
					: '`openssl` could not make the development certificate (EC P-256 with `-addext`).',
				suggestion: missing
					? 'Install OpenSSL 3, then run `loam-host dev` again.'
					: 'Use OpenSSL 1.1.1 or later, which takes `-addext` and `-pkeyopt ec_paramgen_curve:P-256`.',
			},
		]);
	}
}

/** The generated 32-byte auth secret, kept until the directory goes; base64url, so 43 characters. */
export async function ensureAuthSecret(data: string): Promise<string> {
	const directory = join(data, SECRETS_DIRECTORY);
	await privateDirectory(directory);
	const path = join(directory, 'auth');
	if (!existsSync(path)) await writePrivate(path, `${randomBytes(32).toString('base64url')}\n`);
	await chmod(path, 0o600);
	return path;
}

/** One message the sink keeps (3.7). */
export interface SinkMessage {
	to: string;
	subject: string;
	text: string;
	at: string;
}

/** The development profile's mail: one JSON line per message in `<data>/mail.jsonl`, 0600. */
export interface MailSink {
	readonly path: string;
	send(message: Omit<SinkMessage, 'at'>): Promise<void>;
}

export async function createMailSink(data: string): Promise<MailSink> {
	const path = join(data, MAIL_FILE);
	if (!existsSync(path)) await writePrivate(path, '');
	await chmod(path, 0o600);
	return {
		path,
		async send(message) {
			await appendFile(path, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
		},
	};
}

/** The sink's messages, oldest first; a line cut short by a crash is dropped. */
export async function readMail(data: string): Promise<SinkMessage[]> {
	let text: string;
	try {
		text = await readFile(join(data, MAIL_FILE), 'utf8');
	} catch {
		return [];
	}
	return text
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as SinkMessage];
			} catch {
				return [];
			}
		});
}

/** `dev.json`: the ports the origin and the sandbox's origin are bound to, kept across runs. */
export interface DevPorts {
	port: number;
	sandboxPort?: number;
}

const isPort = (value: unknown): value is number =>
	Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65_535;

/**
 * `dev.json`'s ports, or `null` when there is no file. A file that cannot be read as ports is refused rather
 * than read as missing, since a new port would change the origin the provider and every passkey bind to.
 */
export function readDevPorts(data: string): DevPorts | null {
	const path = join(data, DEV_FILE);
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw cause;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = null;
	}
	const ports = parsed as Partial<DevPorts> | null;
	if (
		typeof ports !== 'object' ||
		ports === null ||
		!isPort(ports.port) ||
		(ports.sandboxPort !== undefined && !isPort(ports.sandboxPort))
	) {
		throw new HostError([
			{
				code: 'HOST_CONFIG_INVALID',
				key: path,
				message:
					'`dev.json` does not hold the ports the profile recorded: `port`, and `sandboxPort` if any, each from 1 to 65535.',
				suggestion:
					'Remove `dev.json` to choose new ports, which changes the origin the provider and every passkey bind to.',
			},
		]);
	}
	return {
		port: ports.port,
		...(ports.sandboxPort !== undefined ? { sandboxPort: ports.sandboxPort } : {}),
	};
}

export async function writeDevPorts(data: string, ports: DevPorts): Promise<void> {
	await writePrivate(join(data, DEV_FILE), `${JSON.stringify(ports)}\n`);
}
