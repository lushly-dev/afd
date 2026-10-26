import GitHub from '@auth/core/providers/github';

const GITHUB_SCOPE = 'read:user user:email';
const GITHUB_API_USER_URL = 'https://api.github.com/user';
const GITHUB_API_EMAILS_URL = 'https://api.github.com/user/emails';
const USERINFO_TIMEOUT_MS = 10_000;
const MAX_USERINFO_BODY_BYTES = 64 * 1024;

async function readBoundedJson(response) {
	const contentLength = response.headers.get('content-length');
	if (contentLength && Number(contentLength) > MAX_USERINFO_BODY_BYTES) {
		throw new Error('GitHub identity response exceeds the fixture limit');
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error('GitHub identity response is empty');
	const chunks = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > MAX_USERINFO_BODY_BYTES) {
				await reader.cancel();
				throw new Error('GitHub identity response exceeds the fixture limit');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

export function createGitHubOAuthProvider({
	clientId,
	clientSecret,
	fetcher = (url, options) => globalThis.fetch(url, options),
	trustedUserInfo,
	trustedProfile,
}) {
	return GitHub({
		clientId,
		clientSecret,
		authorization: { params: { scope: GITHUB_SCOPE } },
		userinfo: {
			url: GITHUB_API_USER_URL,
			async request({ tokens }) {
				if (typeof tokens.access_token !== 'string') {
					throw new Error('GitHub OAuth access token is unavailable');
				}
				try {
					const headers = {
						Accept: 'application/vnd.github+json',
						Authorization: `Bearer ${tokens.access_token}`,
						'User-Agent': 'afd-hosted-auth-fixture',
					};
					const fetchOptions = {
						headers,
						redirect: 'error',
						signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
					};
					const [profileResponse, emailsResponse] = await Promise.all([
						fetcher(GITHUB_API_USER_URL, fetchOptions),
						fetcher(GITHUB_API_EMAILS_URL, fetchOptions),
					]);
					if (!profileResponse.ok || !emailsResponse.ok) {
						throw new Error('GitHub identity endpoint rejected the request');
					}
					const profile = await readBoundedJson(profileResponse);
					const emails = await readBoundedJson(emailsResponse);
					if (!Array.isArray(emails)) throw new Error('GitHub email response is invalid');
					return trustedUserInfo(profile, emails);
				} catch {
					throw new Error('GitHub verified primary identity lookup failed');
				}
			},
		},
		profile(profile) {
			return trustedProfile(profile);
		},
	});
}
