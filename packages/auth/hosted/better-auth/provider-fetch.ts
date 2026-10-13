/** Child-process network policy. Delegates to real fetch; never fabricates provider responses. */
export function secureEndpoint(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Missing external OIDC endpoint');
	const url = new URL(value);
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
		throw new Error('External OIDC endpoints must use HTTPS without URL credentials or fragments');
	}
	return url.href;
}
export function validateDiscovery(document: unknown, expectedIssuer: string) {
	secureEndpoint(expectedIssuer);
	if (!document || typeof document !== 'object' || Array.isArray(document))
		throw new Error('Invalid OIDC discovery document');
	const metadata = document as Record<string, unknown>;
	if (metadata.issuer !== expectedIssuer)
		throw new Error('OIDC issuer does not match configured issuer');
	for (const field of [
		'issuer',
		'authorization_endpoint',
		'token_endpoint',
		'userinfo_endpoint',
		'jwks_uri',
	])
		secureEndpoint(metadata[field]);
	if (metadata.end_session_endpoint !== undefined) secureEndpoint(metadata.end_session_endpoint);
	if (
		!Array.isArray(metadata.id_token_signing_alg_values_supported) ||
		metadata.id_token_signing_alg_values_supported.length === 0 ||
		metadata.id_token_signing_alg_values_supported.includes('none')
	) {
		throw new Error('OIDC discovery must advertise signed ID tokens');
	}
}
export function secureProviderFetch(
	nativeFetch: typeof fetch,
	options: {
		localOAuthOrigin?: string;
		discoveryURL?: string;
		expectedIssuer?: string;
	}
): typeof fetch {
	if (options.localOAuthOrigin) {
		const local = new URL(options.localOAuthOrigin);
		if (
			local.protocol !== 'http:' ||
			local.hostname !== '127.0.0.1' ||
			local.origin !== options.localOAuthOrigin
		)
			throw new Error('Invalid test-only OAuth origin');
	}
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.origin !== options.localOAuthOrigin) secureEndpoint(url.href);
		const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const timeout = AbortSignal.timeout(10_000);
		const response = await nativeFetch(input, {
			...init,
			redirect: 'error',
			signal: upstreamSignal ? AbortSignal.any([upstreamSignal, timeout]) : timeout,
		});
		if (options.discoveryURL && url.href === options.discoveryURL && response.ok) {
			validateDiscovery(await response.clone().json(), options.expectedIssuer ?? '');
		}
		return response;
	};
}
