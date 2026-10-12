import { type FixtureConfig, startFixture } from './provider.js';
import { secureEndpoint, secureProviderFetch } from './provider-fetch.js';

try {
	const config = JSON.parse(process.env.AFD_BA_INTERNAL_CONFIG ?? '') as FixtureConfig;
	delete process.env.AFD_BA_INTERNAL_CONFIG;
	globalThis.fetch = secureProviderFetch(globalThis.fetch, {
		localOAuthOrigin: config.localOAuthOrigin,
		discoveryURL: config.discoveryURL,
		expectedIssuer: config.issuer,
	});
	if (!config.localOAuthOrigin) {
		secureEndpoint(config.discoveryURL);
		secureEndpoint(config.issuer);
		if (!(await fetch(config.discoveryURL ?? '')).ok)
			throw new Error('OIDC discovery preflight failed');
	}
	const fixture = await startFixture(config);
	const close = async () => {
		await fixture.close();
		process.exit(0);
	};
	process.once('SIGTERM', () => {
		void close();
	});
	process.once('SIGINT', () => {
		void close();
	});
	process.send?.({ ready: true, instanceId: fixture.instanceId });
} catch {
	process.send?.({ ready: false });
	process.exitCode = 1;
}
