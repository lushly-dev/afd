/**
 * `testOAuthConfig` (phase 3's step 10): the provider's options a suite gives through `startDevHost`, and none for a
 * deployment. The metadata documents' fetch answers only the URLs the suite named and refuses every other, as the
 * provider's own transport refuses an address it may not reach. P3-H1, P3-H3 and P3-H4 run it end to end.
 */

import { describe, expect, it } from 'vitest';
import { createLoamHost } from './host.js';
import { HOST_INTERNALS } from './internal.js';
import { testOAuthConfig } from './provider.js';

const DOCUMENT = 'https://agent.example/oauth/client.json';

describe("testOAuthConfig (phase 3's step 10)", () => {
	it('gives a deployment, which names none, no options at all', () => {
		expect(testOAuthConfig(undefined)).toBeUndefined();
	});

	it("maps a suite's resources and lifetime to `createLoamAuthOptions`' names", () => {
		expect(
			testOAuthConfig({ resources: ['https://other.example/mcp'], accessTokenSeconds: 15 })
		).toEqual({ otherResources: ['https://other.example/mcp'], accessTokenSeconds: 15 });
	});

	it('answers a named document as JSON and refuses every other URL, a named one with a query among them', async () => {
		const fetch = testOAuthConfig({
			clientMetadata: { [DOCUMENT]: { client_id: DOCUMENT } },
		})?.fetchClientMetadataResource as (input: string | URL | Request) => Promise<Response>;
		const answered = await fetch(DOCUMENT);
		expect(answered.status).toBe(200);
		expect(answered.headers.get('content-type')).toBe('application/json');
		expect(await answered.json()).toEqual({ client_id: DOCUMENT });
		expect(await (await fetch(new URL(DOCUMENT))).json()).toEqual({ client_id: DOCUMENT });
		for (const url of [
			'https://agent.example/oauth/other.json',
			`${DOCUMENT}?x=1`,
			'https://127.0.0.1/oauth/client.json',
		])
			await expect(fetch(url), url).rejects.toThrow('no metadata document');
	});

	it("is refused alongside `start`: only the development profile takes a test's options", async () => {
		await expect(
			createLoamHost({
				[HOST_INTERNALS]: { start: true, testOAuth: { accessTokenSeconds: 5 } },
			} as never)
		).rejects.toThrow("`loam-host start` takes no test's provider options");
	});
});
