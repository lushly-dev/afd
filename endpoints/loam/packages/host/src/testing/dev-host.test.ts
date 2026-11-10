import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runDev } from '../dev.js';
import { createMailSink } from '../dev-files.js';
import { fixtureDist, raw, temporaryDirectory } from '../test-support.js';
import { SERVE_STATIC_DEPLOYMENT } from '../testing-only.js';
import { createDevHost, type DevHost } from './dev-host.js';
import type { Launcher } from './launcher.js';

const CONFIG = 'deployment_version = 2\n\n[apps]\n';
const hosts: DevHost[] = [];
afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.close()));
});

interface Call {
	deployment: string;
	env: Record<string, string>;
	certificateExisted: boolean;
	stops: string[];
}

/** The profile in this process: what the child runs, with this suite's small `dist`. */
async function inProcess(): Promise<{ launch: Launcher; calls: Call[] }> {
	const dist = await fixtureDist(await temporaryDirectory());
	const calls: Call[] = [];
	const launch: Launcher = async (deployment, env, logs) => {
		const call: Call = {
			deployment,
			env,
			certificateExisted: existsSync(env.NODE_EXTRA_CA_CERTS ?? ''),
			stops: [],
		};
		calls.push(call);
		const profile = await runDev({ deployment, dist, [SERVE_STATIC_DEPLOYMENT]: true });
		logs.push(`ready ${profile.origin}`);
		const { origin, sandboxOrigin, spki, certificate, mail, data } = profile;
		return {
			ready: { origin, sandboxOrigin, spki, certificate, mail, data },
			async stop(signal) {
				call.stops.push(signal);
				await profile.host.close();
			},
		};
	};
	return { launch, calls };
}

async function start(options: Partial<Parameters<typeof createDevHost>[0]> = {}) {
	const { launch, calls } = await inProcess();
	const host = await createDevHost({ config: CONFIG, ...options }, launch);
	hosts.push(host);
	return { host, calls };
}

describe('startDevHost, in-process (5.2)', () => {
	it.each([
		['organization', { slug: 'acme', name: 'Acme' }, 'step 3'],
		['people', [], 'step 3'],
		['resources', ['https://example.com/mcp'], 'step 4'],
		['accessTokenTtlSeconds', 60, 'step 4'],
		['modules', [], 'HostModule'],
	])('refuses `%s` until the step that builds it', async (key, value, step) => {
		const { launch, calls } = await inProcess();
		await expect(createDevHost({ config: CONFIG, [key]: value }, launch)).rejects.toThrow(step);
		expect(calls).toEqual([]);
	});

	it('writes the deployment with its base path, makes the certificate before the profile starts, and reports it', async () => {
		const { host, calls } = await start({ basePath: '/loam/', env: { LOAM_TEST: '1' } });
		const [call] = calls;
		expect(readFileSync(call?.deployment as string, 'utf8')).toBe(
			`${CONFIG}\n\n[site]\nbase_path = "/loam/"`
		);
		expect(call?.certificateExisted).toBe(true);
		expect(call?.env).toEqual({ LOAM_TEST: '1', NODE_EXTRA_CA_CERTS: host.certificate });
		expect(host.origin).toMatch(/^https:\/\/localhost:\d+$/);
		expect(host.root).toBe(`${host.origin}/loam/`);
		expect(host.sandboxOrigin).toBeNull();
		expect(host.spki).toMatch(/=$/);
		expect(host.data.endsWith('.loam-dev')).toBe(true);
		expect(host.logs()).toEqual([`ready ${host.origin}`]);
		const answer = await raw(Number(new URL(host.origin).port), '/loam/', {
			host: new URL(host.origin).host,
			accept: 'text/html',
			tls: true,
		});
		expect(answer.status).toBe(200);
	});

	it("reads the mail sink, the server's journal and its stores", async () => {
		const { host } = await start();
		expect(await host.mail()).toEqual([]);
		await (await createMailSink(host.data)).send({
			to: 'owner@example.com',
			subject: 'Join',
			text: 'a link',
		});
		expect(await host.mail()).toEqual([
			{ to: 'owner@example.com', subject: 'Join', text: 'a link', at: expect.any(String) },
		]);
		expect(await host.journal()).toEqual([]);
		await writeFile(
			join(host.data, 'journal.jsonl'),
			'{"seq":1,"command":"project-create"}\n{"seq":2,"comm'
		);
		expect(await host.journal()).toEqual([{ seq: 1, command: 'project-create' }]);
		expect(() => host.db()).toThrow('`auth.sqlite` does not exist yet.');
		for (const name of ['auth.sqlite', 'loam.sqlite']) {
			const database = new DatabaseSync(join(host.data, name));
			database.exec('CREATE TABLE t (v TEXT)');
			database.close();
		}
		const { auth, loam } = host.db();
		expect(auth.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
		expect(() => loam.exec('INSERT INTO t VALUES (1)')).toThrow();
		auth.close();
		loam.close();
	});

	it('restarts with the same origin, kills, and closes, removing its directory', async () => {
		const { host, calls } = await start();
		const origin = host.origin;
		await host.restart();
		expect(host.origin).toBe(origin);
		expect(calls[0]?.stops).toEqual(['SIGTERM']);
		await host.kill();
		expect(calls[1]?.stops).toEqual(['SIGKILL']);
		const root = join(host.data, '..');
		await host.close();
		expect(existsSync(root)).toBe(false);
		expect(() => host.origin).toThrow('not running');
	});

	it('refuses a restart that would change the origin', async () => {
		const { launch } = await inProcess();
		let launches = 0;
		const host = await createDevHost({ config: CONFIG }, async (deployment, env, logs) => {
			const launched = await launch(deployment, env, logs);
			launches++;
			return launches === 1
				? launched
				: { ...launched, ready: { ...launched.ready, origin: 'https://localhost:1' } };
		});
		hosts.push(host);
		await expect(host.restart()).rejects.toThrow('The origin changed across a restart');
	});

	it('removes its directory when the profile fails to start', async () => {
		let root = '';
		await expect(
			createDevHost({ config: CONFIG }, async (deployment) => {
				root = join(deployment, '..');
				throw Object.assign(new Error('refused'), { code: 'HOST_DATA_LOCKED' });
			})
		).rejects.toMatchObject({ code: 'HOST_DATA_LOCKED' });
		expect(root).not.toBe('');
		expect(existsSync(root)).toBe(false);
	});
});
