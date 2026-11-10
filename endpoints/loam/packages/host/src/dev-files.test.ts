import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	createMailSink,
	ensureAuthSecret,
	ensureCertificate,
	MAIL_FILE,
	readDevPorts,
	readMail,
	spkiOf,
	writeDevPorts,
} from './dev-files.js';
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
		await writeFile(join(data, 'dev.json'), '{"port":"8443"}');
		expect(readDevPorts(data)).toBeNull();
		await writeFile(join(data, 'dev.json'), 'not json');
		expect(readDevPorts(data)).toBeNull();
	});
});
