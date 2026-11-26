/**
 * Phase 5's step 2 in the CLI (phase 5 specification, 4.1 and 4.2; P5-A3's CLI rows): `deployment write` with
 * `[copilot]` (the projection's providers, never a key or an endpoint; `frame-src` naming the sandbox origin;
 * `models.json` owner-only with references, never a key; `--models-out` where it belongs) and `loam copilot key set`
 * (read without echo, stored where the deployment names it, checked with one request, and never in its result).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readProjection } from '@lushly-dev/loam-manifest/validate';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import { createCopilotKeySetCommand } from './commands.js';
import { checkRequest, copilotKeySet, KEY_PATTERN, systemKeychain } from './copilot-key.js';
import { writeDeployment } from './deployment.js';
import { temporaryDirectory } from './test-support.js';

const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";
const KEY = 'sk-ant-api03-a-key-that-must-never-be-written-AAAA';
const ENDPOINT = 'http://127.0.0.1:11434/v1';

const COPILOT = `
[copilot]
default = "claude"

[[copilot.providers]]
id = "claude"
kind = "anthropic"
model = "claude-sonnet-4-5"
key = { keychain = "loam-copilot", account = "claude" }

[[copilot.providers]]
id = "local"
kind = "openai-compatible"
model = "llama3.1:8b"
endpoint = "${ENDPOINT}/"

[[copilot.providers]]
id = "filed"
kind = "openai"
model = "gpt-5"
key = { file = "keys/openai.key" }

[[copilot.providers]]
id = "scripted"
kind = "test"
model = "script"
`;

const file = (kind: string, copilot = COPILOT) =>
	`deployment_version = 4\napps = {}\n\n[workspace]\nid = "personal"\n\n[host]\nkind = "${kind}"\n${copilot}`;

async function put(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

async function layout(toml: string) {
	const root = await temporaryDirectory();
	await put(root, 'deploy/loam.deployment.toml', toml);
	await put(
		root,
		'dist/index.html',
		`<!doctype html>\n<html><head>\n<meta\n\thttp-equiv="Content-Security-Policy"\n\tcontent="${CSP}"\n/>\n</head></html>`
	);
	await put(root, 'dist/assets/app.js', '1;');
	return {
		root,
		config: join(root, 'deploy/loam.deployment.toml'),
		dist: join(root, 'dist'),
		out: join(root, 'out'),
	};
}

const served = (out: string) =>
	readdirSync(out, { recursive: true })
		.map((name) => join(out, String(name)))
		.filter((path) => statSync(path).isFile())
		.map((path) => readFileSync(path, 'utf8'))
		.join('\n');

describe('deployment write with `[copilot]` (4.1, 4.2)', () => {
	it('projects each provider’s id, kind and model, never a key or an endpoint, and frames the sandbox origin', async () => {
		const paths = await layout(file('desktop'));
		const modelsOut = join(paths.root, 'private/models.json');
		const written = await writeDeployment({ ...paths, modelsOut, platform: process.platform });
		expect(written.ok ? [] : written.refusals).toEqual([]);
		const projection = JSON.parse(readFileSync(join(paths.out, 'deployment.json'), 'utf8'));
		expect(projection.copilot).toEqual({
			default: 'claude',
			providers: [
				{ id: 'claude', kind: 'anthropic', model: 'claude-sonnet-4-5' },
				{ id: 'local', kind: 'openai-compatible', model: 'llama3.1:8b' },
				{ id: 'filed', kind: 'openai', model: 'gpt-5' },
				{ id: 'scripted', kind: 'test', model: 'script' },
			],
		});
		expect(readProjection(projection).ok).toBe(true);
		const text = served(paths.out);
		for (const secret of ['127.0.0.1:11434', 'keychain', 'loam-copilot', 'openai.key'])
			expect(text).not.toContain(secret);
		// Step 1's seam: with no view app, the copilot's frame still needs the sandbox origin in `frame-src`.
		const policy = /content="([^"]*)"/.exec(
			readFileSync(join(paths.out, 'index.html'), 'utf8')
		)?.[1];
		expect(policy).toContain(`frame-src ${projection.sandbox_origin};`);
		expect(projection.sandbox_origin).toMatch(
			/^(http:\/\/loam-sandbox\.localhost|loam-sandbox:\/\/localhost)$/
		);
	});

	it('writes models.json owner-only, with every provider but `test` and a reference to its key, never a key', async () => {
		const paths = await layout(file('desktop'));
		const modelsOut = join(paths.root, 'private/models.json');
		await writeDeployment({ ...paths, modelsOut, platform: process.platform });
		const models = JSON.parse(readFileSync(modelsOut, 'utf8'));
		expect(models).toEqual({
			providers: [
				{
					id: 'claude',
					kind: 'anthropic',
					model: 'claude-sonnet-4-5',
					key: { keychain: 'loam-copilot', account: 'claude' },
				},
				{ id: 'local', kind: 'openai-compatible', model: 'llama3.1:8b', endpoint: ENDPOINT },
				{
					id: 'filed',
					kind: 'openai',
					model: 'gpt-5',
					key: { file: join(paths.root, 'deploy/keys/openai.key') },
				},
			],
		});
		if (process.platform !== 'win32') expect(statSync(modelsOut).mode & 0o777).toBe(0o600);
	});

	it('needs `--models-out` on the desktop for a provider but `test`, and refuses it on any other host', async () => {
		const desktop = await layout(file('desktop'));
		const missing = await writeDeployment({ ...desktop, platform: process.platform });
		expect(missing.ok === false && missing.refusals.map(({ key }) => key)).toEqual([
			'--models-out',
		]);
		const scripted = await layout(
			file('desktop', '\n[copilot]\n[[copilot.providers]]\nid = "s"\nkind = "test"\nmodel = "m"\n')
		);
		expect(await writeDeployment({ ...scripted, platform: process.platform })).toMatchObject({
			ok: true,
		});
		const statics = await layout(
			file('static', '\n[copilot]\n[[copilot.providers]]\nid = "s"\nkind = "test"\nmodel = "m"\n')
		);
		const refused = await writeDeployment({
			...statics,
			modelsOut: join(statics.root, 'private/models.json'),
		});
		expect(refused.ok === false && refused.refusals.map(({ key }) => key)).toEqual([
			'--models-out',
		]);
	});

	it('refuses `--models-out` inside what is served, on `--mounts-out`, or on the deployment file', async () => {
		const paths = await layout(file('desktop'));
		const mountsOut = join(paths.root, 'private/mounts.json');
		// On a volume that ignores case, a path that differs only by case is the same file (Windows, macOS).
		const folded =
			process.platform === 'win32' || process.platform === 'darwin'
				? [mountsOut.toUpperCase()]
				: [];
		for (const modelsOut of [join(paths.dist, 'models.json'), mountsOut, paths.config, ...folded]) {
			const written = await writeDeployment({
				...paths,
				mountsOut,
				modelsOut,
				platform: process.platform,
			});
			expect(written.ok === false && written.refusals.map(({ key }) => key), modelsOut).toContain(
				'--models-out'
			);
		}
	});

	it('`COPILOT_PROVIDER_HOST`: a static deployment with a real provider is refused, and nothing is written', async () => {
		const paths = await layout(file('static'));
		const refused = await writeDeployment(paths);
		expect(refused.ok === false && refused.refusals.map(({ code }) => code)).toEqual([
			'COPILOT_PROVIDER_HOST',
			'COPILOT_PROVIDER_HOST',
			'COPILOT_PROVIDER_HOST',
		]);
	});

	it('a key file is a credential: inside `--dist` it is refused, as a bearer file is', async () => {
		const paths = await layout(
			file(
				'desktop',
				'\n[copilot]\n[[copilot.providers]]\nid = "o"\nkind = "openai"\nmodel = "m"\nkey = { file = "../dist/k.key" }\n'
			)
		);
		const refused = await writeDeployment({
			...paths,
			modelsOut: join(paths.root, 'private/models.json'),
			platform: process.platform,
		});
		expect(refused.ok === false && refused.refusals.map(({ key }) => key)).toContain('--dist');
	});
});

describe('`loam copilot key set` (4.2)', () => {
	function deps(
		answer: { status?: number; throws?: boolean } = {},
		secret = KEY
	): {
		stored: Array<[string, string, string]>;
		requests: Array<{ url: string; init: RequestInit }>;
		prompts: string[];
		value: Parameters<typeof copilotKeySet>[1];
	} {
		const stored: Array<[string, string, string]> = [];
		const requests: Array<{ url: string; init: RequestInit }> = [];
		const prompts: string[] = [];
		return {
			stored,
			requests,
			prompts,
			value: {
				async readSecret(prompt) {
					prompts.push(prompt);
					return `${secret}\n`;
				},
				keychain: {
					async set(service, account, value) {
						stored.push([service, account, value]);
					},
				},
				fetch: (async (url: string, init: RequestInit) => {
					requests.push({ url, init });
					if (answer.throws) throw new Error('offline');
					return new Response('{}', { status: answer.status ?? 200 });
				}) as never,
			},
		};
	}

	it('stores the key under the entry’s service and account, checks it once, and returns no key', async () => {
		const paths = await layout(file('desktop'));
		const made = deps();
		const result = await copilotKeySet({ provider: 'claude', config: paths.config }, made.value);
		expect(result).toEqual({
			ok: true,
			provider: 'claude',
			service: 'loam-copilot',
			account: 'claude',
			checked: true,
			answered: 200,
		});
		expect(made.stored).toEqual([['loam-copilot', 'claude', KEY]]);
		expect(made.prompts).toEqual(['Key for claude (anthropic): ']);
		expect(made.prompts.join('')).not.toContain(KEY);
		expect(made.requests).toHaveLength(1);
		expect(made.requests[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1');
		expect(made.requests[0]?.init.redirect).toBe('error');
		expect(JSON.stringify(result)).not.toContain(KEY);
	});

	it('through the CLI: its JSON result names the entry and never holds the key', async () => {
		const paths = await layout(file('desktop'));
		const made = deps();
		const command = createCopilotKeySetCommand(() => made.value);
		const output: string[] = [];
		const handler = command.handler as (input: unknown, context: object) => Promise<unknown>;
		const result = await handler({ provider: 'claude', config: paths.config }, {});
		output.push(JSON.stringify(result));
		expect(output.join('')).not.toContain(KEY);
		expect(result).toMatchObject({
			success: true,
			data: {
				provider: 'claude',
				keychain: { service: 'loam-copilot', account: 'claude' },
				checked: true,
			},
		});
		// The bin knows the three-word command, and refuses a provider id off its pattern before reading anything.
		const lines: string[] = [];
		expect(
			await runCli(['copilot', 'key', 'set', 'Bad!', '--config', paths.config], {
				stdout: (text) => lines.push(text),
			})
		).toBe(1);
		expect(JSON.parse(lines.join('')).error.code).toBe('CLI_USAGE');
	});

	it('a refused check says so, and an unreachable provider stores the key unchecked', async () => {
		const paths = await layout(file('desktop'));
		const refused = await copilotKeySet(
			{ provider: 'claude', config: paths.config },
			deps({ status: 401 }).value
		);
		expect(refused).toMatchObject({ ok: false, code: 'MODEL_REFUSED' });
		expect(JSON.stringify(refused)).not.toContain(KEY);
		const offline = await copilotKeySet(
			{ provider: 'claude', config: paths.config },
			deps({ throws: true }).value
		);
		expect(offline).toMatchObject({ ok: true, checked: false });
	});

	it('refuses an unknown provider, the test provider, a key kept in a file, and a value that is no key', async () => {
		const paths = await layout(file('desktop'));
		const cases: Array<[string, string, string]> = [
			['nobody', KEY, 'COPILOT_PROVIDER_UNKNOWN'],
			['scripted', KEY, 'COPILOT_KEY_UNUSED'],
			['filed', KEY, 'COPILOT_KEY_UNUSED'],
			['local', KEY, 'COPILOT_KEY_UNUSED'],
			['claude', 'short', 'COPILOT_KEY_INVALID'],
			['claude', 'has a space in it', 'COPILOT_KEY_INVALID'],
			['claude', 'quote"inside-the-key', 'COPILOT_KEY_INVALID'],
		];
		for (const [provider, secret, code] of cases) {
			const made = deps({}, secret);
			const result = await copilotKeySet({ provider, config: paths.config }, made.value);
			expect(result, provider).toMatchObject({ ok: false, code });
			expect(made.stored).toEqual([]);
			expect(made.requests).toEqual([]);
		}
	});

	it('checks each kind at its own fixed endpoint, or the configured one, with its key header alone', () => {
		expect(checkRequest('anthropic', KEY)).toEqual({
			url: 'https://api.anthropic.com/v1/models?limit=1',
			headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
		});
		expect(checkRequest('openai', KEY).url).toBe('https://api.openai.com/v1/models');
		expect(checkRequest('openai-compatible', KEY, `${ENDPOINT}/`)).toEqual({
			url: `${ENDPOINT}/models`,
			headers: { authorization: `Bearer ${KEY}` },
		});
		expect(KEY_PATTERN.test(KEY)).toBe(true);
	});

	it('on macOS, fails on non-empty `security -i` stderr (even on exit 0) and verifies read-back equality', async () => {
		const calls: Array<{ program: string; args: string[]; stdin?: string }> = [];
		const okKeychain = systemKeychain('darwin', async (program, args, stdin) => {
			calls.push({ program, args, ...(stdin !== undefined ? { stdin } : {}) });
			if (args[0] === '-i') return { code: 0, stdout: '', stderr: '' };
			return { code: 0, stdout: `${KEY}\n`, stderr: '' };
		});
		await okKeychain.set('loam-copilot', 'claude', KEY);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual({
			program: '/usr/bin/security',
			args: ['-i'],
			stdin: `add-generic-password -U -s "loam-copilot" -a "claude" -l "Loam copilot key" -w "${KEY}"\n`,
		});
		expect(calls[1]).toEqual({
			program: '/usr/bin/security',
			args: ['find-generic-password', '-s', 'loam-copilot', '-a', 'claude', '-w'],
		});
		// Secret never appears in argv of either invocation.
		expect(calls.flatMap((c) => c.args).join(' ')).not.toContain(KEY);

		// Silent exit-0 failure from `security -i` (error printed only to stderr) is refused before read-back.
		let readBackCalls = 0;
		const silentFail = systemKeychain('darwin', async (_program, args) => {
			if (args[0] === '-i') {
				return {
					code: 0,
					stdout: '',
					stderr: 'security: SecKeychainAddGenericPassword: User canceled',
				};
			}
			readBackCalls += 1;
			return { code: 0, stdout: `${KEY}\n`, stderr: '' };
		});
		const silentErr = await silentFail
			.set('loam-copilot', 'claude', KEY)
			.catch((err: Error) => err);
		expect(silentErr).toBeInstanceOf(Error);
		expect((silentErr as Error).message).not.toContain(KEY);
		expect(readBackCalls).toBe(0);

		// Mismatched read-back is refused without leaking the secret.
		const mismatch = systemKeychain('darwin', async (_program, args) => {
			if (args[0] === '-i') return { code: 0, stdout: '', stderr: '' };
			return { code: 0, stdout: 'different-stored-secret\n', stderr: '' };
		});
		const mismatchErr = await mismatch
			.set('loam-copilot', 'claude', KEY)
			.catch((err: Error) => err);
		expect(mismatchErr).toBeInstanceOf(Error);
		expect((mismatchErr as Error).message).not.toContain(KEY);

		// Non-zero exit on read-back is refused.
		const missingReadBack = systemKeychain('darwin', async (_program, args) => {
			if (args[0] === '-i') return { code: 0, stdout: '', stderr: '' };
			return { code: 44, stdout: '', stderr: 'not found' };
		});
		await expect(missingReadBack.set('loam-copilot', 'claude', KEY)).rejects.toThrow();

		// Whitespace-only stderr on `security -i` is also refused before read-back.
		let wsReadBackCalls = 0;
		const whitespaceStderr = systemKeychain('darwin', async (_program, args) => {
			if (args[0] === '-i') return { code: 0, stdout: '', stderr: ' ' };
			wsReadBackCalls += 1;
			return { code: 0, stdout: `${KEY}\n`, stderr: '' };
		});
		await expect(whitespaceStderr.set('loam-copilot', 'claude', KEY)).rejects.toThrow();
		expect(wsReadBackCalls).toBe(0);

		// A valid 4,096-character key whose encoded `security -i` line exceeds Apple's 4,095-byte buffer
		// is refused BEFORE spawning `/usr/bin/security`, leaving any existing credential intact.
		const oversizedKey = 'k'.repeat(4096);
		expect(KEY_PATTERN.test(oversizedKey)).toBe(true);
		let oversizedCalls = 0;
		const oversizedKeychain = systemKeychain('darwin', async () => {
			oversizedCalls += 1;
			return { code: 0, stdout: '', stderr: '' };
		});
		const oversizedErr = await oversizedKeychain
			.set('loam-copilot', 'claude', oversizedKey)
			.catch((err: Error) => err);
		expect(oversizedErr).toBeInstanceOf(Error);
		expect((oversizedErr as Error).message).not.toContain(oversizedKey);
		expect(oversizedCalls).toBe(0);
	});
});
