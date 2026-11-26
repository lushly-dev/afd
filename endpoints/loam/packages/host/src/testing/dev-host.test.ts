import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runDev } from '../dev.js';
import { createMailSink } from '../dev-files.js';
import { fixtureDist, raw, temporaryDirectory } from '../test-support.js';
import { createDevHost, type DevHost, withBasePath } from './dev-host.js';
import type { Launcher } from './launcher.js';

const CONFIG = 'deployment_version = 4\n\n[host]\nkind = "hosted"\n\n[apps]\n';
const PROVIDER =
	'deployment_version = 4\n\n[workspace]\nid = "acme"\n\n[host]\nkind = "hosted"\n\n[identity]\nmode = "provider"\norganization = "acme"\nmethods = ["passkey", "password"]\n\n[apps]\n';
const hosts: DevHost[] = [];
afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.close()));
});

interface Call {
	deployment: string;
	env: Record<string, string>;
	certificateExisted: boolean;
	stops: string[];
	testOAuth?: unknown;
}

/** The profile in this process: what the child runs, with this suite's small `dist`. */
async function inProcess(): Promise<{ launch: Launcher; calls: Call[] }> {
	const dist = await fixtureDist(await temporaryDirectory());
	const calls: Call[] = [];
	const launch: Launcher = async (deployment, env, logs, _rateLimit, _limits, testOAuth) => {
		const call: Call = {
			deployment,
			env,
			certificateExisted: existsSync(env.NODE_EXTRA_CA_CERTS ?? ''),
			stops: [],
			...(testOAuth ? { testOAuth } : {}),
		};
		calls.push(call);
		const profile = await runDev({ deployment, dist, ...(testOAuth ? { testOAuth } : {}) });
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
	it.each([['modules', [], 'HostModule']])(
		'refuses `%s` until the step that builds it',
		async (key, value, step) => {
			const { launch, calls } = await inProcess();
			await expect(createDevHost({ config: CONFIG, [key]: value }, launch)).rejects.toThrow(step);
			expect(calls).toEqual([]);
		}
	);

	it('bootstraps the organization and seeds its people before the profile starts, through bootstrap --dev (5.2, 3.7)', async () => {
		const { host, calls } = await start({
			config: PROVIDER,
			organization: { slug: 'acme', name: 'Acme', owner: 'first@acme.example' },
			people: [
				{
					email: 'olu@acme.example',
					name: 'Olu',
					role: 'owner',
					methods: ['password'],
					password: 'p'.repeat(12),
				},
				{ email: 'bea@acme.example', name: 'Bea', role: 'member' },
			],
		});
		expect(calls).toHaveLength(1);
		const mail = await host.mail();
		expect(mail.map(({ to }) => to)).toEqual(['first@acme.example']);
		expect(mail[0]?.text).toContain(`${host.origin}/~/join?invitation=`);
		const { auth } = host.db();
		const members = auth
			.prepare(
				'SELECT u.email AS email, m.role AS role FROM member m JOIN user u ON u.id = m.userId ORDER BY u.email'
			)
			.all();
		expect(members).toEqual([
			{ email: 'bea@acme.example', role: 'member' },
			{ email: 'olu@acme.example', role: 'owner' },
		]);
	});

	it("pre-registers `clients` by the seeded owner, as the deployer's server API does, and reports their ids (P6-H4)", async () => {
		const { host } = await start({
			config: PROVIDER,
			organization: { slug: 'acme', name: 'Acme' },
			people: [
				{
					email: 'olu@acme.example',
					name: 'Olu',
					role: 'owner',
					methods: ['password'],
					password: 'p'.repeat(12),
				},
			],
			clients: [{ name: 'agent', redirect: 'http://127.0.0.1:43123/callback' }],
		});
		const id = host.clients.agent as string;
		expect(id).toBeTruthy();
		const row = host
			.db()
			.auth.prepare('SELECT name, redirectUris FROM oauthClient WHERE clientId = ?')
			.get(id) as { name: string; redirectUris: string } | undefined;
		expect(row?.name).toBe('agent');
		expect(row?.redirectUris).toContain('http://127.0.0.1:43123/callback');
	});

	it("phase 3's step 10: `resources`, `accessTokenTtlSeconds` and `clientMetadata` reach the provider of the bootstrap and of the profile, and a client is linked to each resource", async () => {
		const other = 'https://other.example/mcp';
		const document = { client_id: 'https://agent.example/client.json' };
		const { host, calls } = await start({
			config: PROVIDER,
			organization: { slug: 'acme', name: 'Acme' },
			people: [
				{
					email: 'olu@acme.example',
					name: 'Olu',
					role: 'owner',
					methods: ['password'],
					password: 'p'.repeat(12),
				},
			],
			clients: [{ name: 'agent', redirect: 'http://127.0.0.1:43123/callback' }],
			resources: [other],
			accessTokenTtlSeconds: 5,
			clientMetadata: { [document.client_id]: document },
		});
		expect(calls.map((call) => call.testOAuth)).toEqual([
			{
				resources: [other],
				accessTokenSeconds: 5,
				clientMetadata: { [document.client_id]: document },
			},
		]);
		// Linked at registration, in the bootstrap's provider: the profile's own MCP resource and the other one.
		const linked = host
			.db()
			.auth.prepare(
				'SELECT resourceId FROM oauthClientResource WHERE clientId = ? ORDER BY resourceId'
			)
			.all(host.clients.agent as string) as Array<{ resourceId: string }>;
		expect(linked.map((row) => row.resourceId)).toEqual([`${host.root}mcp`, other].sort());
		// And without them, the launcher is told nothing, so the bin's path is the deployment's.
		const plain = await start({ config: CONFIG });
		expect(plain.calls[0]?.testOAuth).toBeUndefined();
	});

	it('refuses `clients` with no organization, or with no owner who has a password', async () => {
		const { launch, calls } = await inProcess();
		const clients = [{ name: 'agent', redirect: 'http://127.0.0.1:43123/callback' }];
		await expect(createDevHost({ config: PROVIDER, clients }, launch)).rejects.toThrow(
			'organization'
		);
		await expect(
			createDevHost(
				{
					config: PROVIDER,
					organization: { slug: 'acme', name: 'Acme' },
					people: [{ email: 'a@acme.example', name: 'A', role: 'member' }],
					clients,
				},
				launch
			)
		).rejects.toThrow('owner with a password');
		expect(calls).toEqual([]);
	});

	it('refuses `people` with no organization, and a password method with no password', async () => {
		const { launch, calls } = await inProcess();
		await expect(
			createDevHost(
				{ config: PROVIDER, people: [{ email: 'a@b.c', name: 'A', role: 'member' }] },
				launch
			)
		).rejects.toThrow('organization');
		await expect(
			createDevHost(
				{
					config: PROVIDER,
					organization: { slug: 'acme', name: 'Acme' },
					people: [{ email: 'a@b.c', name: 'A', role: 'member', methods: ['password'] }],
				},
				launch
			)
		).rejects.toThrow('password');
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
		// Each database opens when it is read, so `auth` reads before `loam.sqlite` exists (step 4).
		expect(() => host.db().auth).toThrow('`auth.sqlite` does not exist yet.');
		expect(() => host.db().loam).toThrow('`loam.sqlite` does not exist yet.');
		for (const name of ['auth.sqlite', 'loam.sqlite']) {
			const database = new DatabaseSync(join(host.data, name));
			database.exec('CREATE TABLE t (v TEXT)');
			database.close();
		}
		const { auth, loam } = host.db();
		expect(auth.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
		expect(() => loam.exec('INSERT INTO t VALUES (1)')).toThrow();
		// One handle each for the host's life, closed with it.
		expect(host.db().auth).toBe(auth);
		await host.close();
		expect(auth.isOpen).toBe(false);
		expect(loam.isOpen).toBe(false);
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

describe("startDevHost's base path (5.2)", () => {
	it('adds a [site] table, or sets base_path in the one the config has', () => {
		expect(withBasePath(CONFIG, undefined)).toBe(CONFIG);
		expect(withBasePath(CONFIG, '/loam/')).toBe(`${CONFIG}\n\n[site]\nbase_path = "/loam/"`);
		const sited = 'deployment_version = 4\n\n[site]\n\n[apps]\n';
		expect(withBasePath(sited, '/loam/')).toBe(
			'deployment_version = 4\n\n[site]\nbase_path = "/loam/"\n\n[apps]\n'
		);
	});

	it('refuses a config whose [site] sets base_path already', () => {
		expect(() =>
			withBasePath('deployment_version = 2\n\n[site]\nbase_path = "/a/"\n\n[apps]\n', '/loam/')
		).toThrow('disagree');
	});
});
