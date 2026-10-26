import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { startFixtureServer } from './server.mjs';

test('serves a slashless deployment origin for the pinned Convex HTTP client', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'afd-convex-server-test-'));
	let server;
	try {
		await writeFile(join(directory, 'index.html'), '<main>fixture</main>');
		await writeFile(join(directory, 'bundle.js'), '');
		server = await startFixtureServer({
			directory,
			deploymentUrl: new URL('https://example.convex.cloud/'),
		});

		const response = await fetch(new URL('/config.js', server.origin));
		assert.equal(response.status, 200);
		const configScript = await response.text();
		const assignment = configScript.match(/^window\.__AFD_CONVEX_CONFIG__=(.*);$/);
		assert.ok(assignment, 'fixture config script should assign its runtime configuration');
		const config = JSON.parse(assignment[1]);
		assert.equal(config.deploymentUrl, 'https://example.convex.cloud');

		let actionUrl;
		const client = new ConvexHttpClient(config.deploymentUrl, {
			fetch: async (input, init) => {
				actionUrl = String(input);
				assert.equal(init.method, 'POST');
				return new Response(JSON.stringify({ status: 'success', value: null }), {
					headers: { 'content-type': 'application/json' },
				});
			},
			logger: false,
		});
		await client.action(makeFunctionReference('auth:signIn'), {});
		assert.equal(actionUrl, 'https://example.convex.cloud/api/action');
	} finally {
		if (server) await server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
