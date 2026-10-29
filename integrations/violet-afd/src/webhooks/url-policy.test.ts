import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ALLOW_PRIVATE_ENV,
	assertWebhookUrlSafe,
	classifyBlockedAddress,
	validateWebhookUrl,
} from './url-policy.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('classifyBlockedAddress', () => {
	it.each([
		'0.0.0.0',
		'10.0.0.1',
		'10.255.255.255',
		'100.64.0.1',
		'100.127.255.254',
		'127.0.0.1',
		'127.1.2.3',
		'169.254.169.254',
		'169.254.0.1',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'::',
		'::1',
		'fc00::1',
		'fd12:3456:789a::1',
		'fe80::1',
		'febf::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:10.1.2.3',
		'::ffff:a9fe:a9fe',
		'[::ffff:169.254.169.254]',
		'64:ff9b::7f00:1',
		'2002:7f00:1::1',
	])('blocks %s', (address) => {
		expect(classifyBlockedAddress(address)).not.toBeNull();
	});

	it.each([
		'8.8.8.8',
		'93.184.216.34',
		'172.15.255.255',
		'172.32.0.1',
		'100.63.255.255',
		'100.128.0.1',
		'192.169.0.1',
		'2606:4700:4700::1111',
		'::ffff:8.8.8.8',
	])('allows %s', (address) => {
		expect(classifyBlockedAddress(address)).toBeNull();
	});

	it('blocks unparseable input', () => {
		expect(classifyBlockedAddress('not-an-ip')).not.toBeNull();
	});
});

describe('validateWebhookUrl', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('accepts a public https URL', () => {
		expect(validateWebhookUrl('https://example.com/hook').ok).toBe(true);
	});

	it('rejects plain http to a public host', () => {
		const result = validateWebhookUrl('http://example.com/hook');
		expect(result.ok).toBe(false);
	});

	it.each([
		'http://localhost:3000/hook',
		'http://127.0.0.1:3000/hook',
		'http://[::1]:3000/hook',
		'https://localhost/hook',
	])('keeps the explicit dev loopback allowance for %s', (url) => {
		expect(validateWebhookUrl(url).ok).toBe(true);
	});

	it('rejects credentials in the URL', () => {
		const result = validateWebhookUrl('https://user:pass@example.com/hook');
		expect(result.ok).toBe(false);
		expect(validateWebhookUrl('https://user@example.com/hook').ok).toBe(false);
		expect(validateWebhookUrl('http://user:pass@localhost/hook').ok).toBe(false);
	});

	it.each([
		'https://10.0.0.5/hook',
		'https://192.168.1.10/hook',
		'https://172.16.5.5/hook',
		'https://169.254.169.254/latest/meta-data/',
		'https://100.64.1.1/hook',
		'https://0.0.0.0/hook',
		'https://127.0.0.2/hook',
		'https://[fd00::1]/hook',
		'https://[fe80::1]/hook',
		'https://[::ffff:127.0.0.1]/hook',
		'https://[::ffff:169.254.169.254]/hook',
		'https://167772161/hook', // decimal form of 10.0.0.1
		'https://0xa.1/hook', // hex form of 10.0.0.1
		'https://foo.localhost/hook',
	])('rejects private/internal host %s', (url) => {
		expect(validateWebhookUrl(url).ok).toBe(false);
	});

	it('allows private hosts when explicitly opted in via option or env', () => {
		expect(validateWebhookUrl('https://10.0.0.5/hook', { allowPrivate: true }).ok).toBe(true);
		vi.stubEnv(ALLOW_PRIVATE_ENV, '1');
		expect(validateWebhookUrl('https://10.0.0.5/hook').ok).toBe(true);
		// ...but the opt-in does not relax protocol or credential rules
		expect(validateWebhookUrl('http://10.0.0.5/hook').ok).toBe(false);
		expect(validateWebhookUrl('https://u:p@10.0.0.5/hook').ok).toBe(false);
	});
});

describe('assertWebhookUrlSafe', () => {
	it('allows a hostname that resolves only to public addresses', async () => {
		const result = await assertWebhookUrlSafe('https://example.com/hook', {
			lookup: publicLookup,
		});
		expect(result.ok).toBe(true);
	});

	it('blocks a hostname that resolves to a private address (DNS rebinding)', async () => {
		const result = await assertWebhookUrlSafe('https://rebind.example.com/hook', {
			lookup: async () => [{ address: '10.0.0.5', family: 4 }],
		});
		expect(result.ok).toBe(false);
	});

	it('blocks when ANY resolved address is private', async () => {
		const result = await assertWebhookUrlSafe('https://mixed.example.com/hook', {
			lookup: async () => [
				{ address: '93.184.216.34', family: 4 },
				{ address: '169.254.169.254', family: 4 },
			],
		});
		expect(result.ok).toBe(false);
	});

	it('blocks a hostname that resolves to loopback or IPv4-mapped IPv6', async () => {
		for (const address of ['127.0.0.1', '::1', '::ffff:7f00:1']) {
			const result = await assertWebhookUrlSafe('https://evil.example.com/hook', {
				lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
			});
			expect(result.ok).toBe(false);
		}
	});

	it('fails closed when DNS lookup fails or returns nothing', async () => {
		expect(
			(
				await assertWebhookUrlSafe('https://example.com/hook', {
					lookup: async () => {
						throw new Error('ENOTFOUND');
					},
				})
			).ok,
		).toBe(false);
		expect(
			(await assertWebhookUrlSafe('https://example.com/hook', { lookup: async () => [] })).ok,
		).toBe(false);
	});

	it('does not resolve dev loopback hosts or literal IPs', async () => {
		const lookup = vi.fn(publicLookup);
		expect((await assertWebhookUrlSafe('http://localhost:3000/x', { lookup })).ok).toBe(true);
		expect((await assertWebhookUrlSafe('http://127.0.0.1:3000/x', { lookup })).ok).toBe(true);
		expect((await assertWebhookUrlSafe('https://10.0.0.1/x', { lookup })).ok).toBe(false);
		expect(lookup).not.toHaveBeenCalled();
	});

	it('skips the address checks when private destinations are opted in', async () => {
		const result = await assertWebhookUrlSafe('https://internal.example.com/hook', {
			allowPrivate: true,
			lookup: async () => [{ address: '10.0.0.5', family: 4 }],
		});
		expect(result.ok).toBe(true);
	});
});
