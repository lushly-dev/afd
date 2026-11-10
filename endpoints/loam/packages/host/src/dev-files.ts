/**
 * @fileoverview The development profile's own files (phase 6 specification, 5.1): its certificate and
 * key, its generated auth secret (section 13's one exception), its mail sink and `dev.json`'s ports. Every
 * file is 0600 and every directory 0700, and the data directory holds a `.gitignore` of `*`.
 */

import { execFile } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
	}
	await chmod(certificate, 0o600);
	await chmod(key, 0o600);
	return { certificate, key, spki: spkiOf(await readFile(certificate)) };
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

export function readDevPorts(data: string): DevPorts | null {
	try {
		const parsed = JSON.parse(readFileSync(join(data, DEV_FILE), 'utf8')) as Partial<DevPorts>;
		if (!Number.isInteger(parsed.port)) return null;
		return {
			port: parsed.port as number,
			...(Number.isInteger(parsed.sandboxPort)
				? { sandboxPort: parsed.sandboxPort as number }
				: {}),
		};
	} catch {
		return null;
	}
}

export async function writeDevPorts(data: string, ports: DevPorts): Promise<void> {
	await writePrivate(join(data, DEV_FILE), `${JSON.stringify(ports)}\n`);
}
