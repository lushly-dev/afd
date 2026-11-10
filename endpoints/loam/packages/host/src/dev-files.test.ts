import { readdirSync, readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	claimDataDirectory,
	createMailSink,
	ensureAuthSecret,
	ensureCertificate,
	MAIL_FILE,
	readDevPorts,
	readMail,
	spkiOf,
	writeDevPorts,
} from './dev-files.js';
import { HostError } from './errors.js';
import { temporaryDirectory } from './test-support.js';

describe("the development profile's files (5.1)", () => {
	it('makes the certificate once, 0600 in a 0700 directory, and reuses it', async () => {
		const data = await temporaryDirectory();
		const first = await ensureCertificate(data);
		expect(statSync(join(data, 'tls')).mode & 0o777).toBe(0o700);
		expect(statSync(first.certificate).mode & 0o777).toBe(0o600);
		expect(statSync(first.key).mode & 0o777).toBe(0o600);
		expect(first.spki).toBe(spkiOf(readFileSync(first.certificate)));
		const second = await ensureCertificate(data);
		expect(second.spki).toBe(first.spki);
		expect(readFileSync(second.certificate, 'utf8')).toBe(readFileSync(first.certificate, 'utf8'));
	});

	it('makes a new certificate when the one there cannot be read as one', async () => {
		const data = await temporaryDirectory();
		const first = await ensureCertificate(data);
		await writeFile(first.certificate, 'not a certificate');
		const second = await ensureCertificate(data);
		expect(readFileSync(second.certificate, 'utf8')).toContain('BEGIN CERTIFICATE');
		expect(second.spki).not.toBe(first.spki);
	});

	it('makes the auth secret once, 32 random bytes as base64url, and keeps it', async () => {
		const data = await temporaryDirectory();
		const path = await ensureAuthSecret(data);
		const secret = readFileSync(path, 'utf8');
		expect(secret.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(Buffer.from(secret.trim(), 'base64url')).toHaveLength(32);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		await ensureAuthSecret(data);
		expect(readFileSync(path, 'utf8')).toBe(secret);
	});

	it('keeps mail in mail.jsonl, 0600, one line a message, and drops a line cut short', async () => {
		const data = await temporaryDirectory();
		expect(await readMail(data)).toEqual([]);
		const sink = await createMailSink(data);
		expect(sink.path).toBe(join(data, MAIL_FILE));
		expect(statSync(sink.path).mode & 0o777).toBe(0o600);
		await sink.send({ to: 'a@example.com', subject: 'Join', text: 'link one' });
		await sink.send({ to: 'b@example.com', subject: 'Recover', text: 'link two' });
		await writeFile(sink.path, `${readFileSync(sink.path, 'utf8')}{"to":"c@exa`);
		expect((await readMail(data)).map(({ to, subject }) => [to, subject])).toEqual([
			['a@example.com', 'Join'],
			['b@example.com', 'Recover'],
		]);
		// A second sink keeps what is there.
		await createMailSink(data);
		expect(await readMail(data)).toHaveLength(2);
	});

	it("reads and writes dev.json's ports, and reads nothing from a file that is not them", async () => {
		const data = await temporaryDirectory();
		expect(readDevPorts(data)).toBeNull();
		await writeDevPorts(data, { port: 8443 });
		expect(readDevPorts(data)).toEqual({ port: 8443 });
		expect(statSync(join(data, 'dev.json')).mode & 0o777).toBe(0o600);
		await writeDevPorts(data, { port: 8443, sandboxPort: 8444 });
		expect(readDevPorts(data)).toEqual({ port: 8443, sandboxPort: 8444 });
	});

	it.each([
		['not JSON', 'not json'],
		['a port as a string', '{"port":"8443"}'],
		['port 0', '{"port":0}'],
		['a port past 65535', '{"port":70000}'],
		['a sandbox port out of range', '{"port":8443,"sandboxPort":-1}'],
		['an array', '[8443]'],
	])('refuses a dev.json holding %s, rather than reading it as missing', async (_name, text) => {
		const data = await temporaryDirectory();
		await writeFile(join(data, 'dev.json'), text);
		expect(() => readDevPorts(data)).toThrow(HostError);
		try {
			readDevPorts(data);
		} catch (cause) {
			expect((cause as HostError).code).toBe('HOST_CONFIG_INVALID');
			expect((cause as HostError).refusals[0]?.key).toBe(join(data, 'dev.json'));
		}
	});

	it("takes a data directory that is missing, empty, or already the profile's, and makes it 0700", async () => {
		const root = await temporaryDirectory();
		await claimDataDirectory(join(root, 'missing'));
		expect(statSync(join(root, 'missing')).mode & 0o777).toBe(0o700);
		for (const [name, file, text] of [
			['empty', undefined, undefined],
			['recorded', 'dev.json', '{"port":8443}'],
			['ignored', '.gitignore', '*\n'],
			['ignored-bare', '.gitignore', '*'],
		] as const) {
			const directory = join(root, name);
			await mkdir(directory, { mode: 0o755 });
			await chmod(directory, 0o755);
			if (file) await writeFile(join(directory, file), text as string);
			await claimDataDirectory(directory);
			expect(statSync(directory).mode & 0o777, name).toBe(0o700);
		}
	});

	it("refuses a directory of someone else's, or a file, and leaves it as it was", async () => {
		const root = await temporaryDirectory();
		const theirs = join(root, 'theirs');
		await mkdir(theirs, { mode: 0o755 });
		await chmod(theirs, 0o755);
		await writeFile(join(theirs, 'notes.txt'), 'mine');
		await writeFile(join(theirs, '.gitignore'), 'node_modules\n');
		await expect(claimDataDirectory(theirs)).rejects.toMatchObject({ code: 'HOST_CONFIG_INVALID' });
		expect(statSync(theirs).mode & 0o777).toBe(0o755);
		expect(readdirSync(theirs).sort()).toEqual(['.gitignore', 'notes.txt']);
		await writeFile(join(root, 'file'), 'x');
		await expect(claimDataDirectory(join(root, 'file'))).rejects.toMatchObject({
			code: 'HOST_CONFIG_INVALID',
		});
	});

	it('names openssl, with a suggestion, when it is not on PATH', async () => {
		const data = await temporaryDirectory();
		const path = process.env.PATH;
		process.env.PATH = '';
		try {
			await expect(ensureCertificate(data)).rejects.toMatchObject({
				code: 'HOST_CONFIG_INVALID',
				refusals: [
					expect.objectContaining({
						key: 'openssl',
						suggestion: expect.stringContaining('OpenSSL'),
					}),
				],
			});
		} finally {
			process.env.PATH = path;
		}
	});
});
