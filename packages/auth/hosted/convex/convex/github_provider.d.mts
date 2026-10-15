import GitHub, { type GitHubEmail, type GitHubProfile } from '@auth/core/providers/github';

export function createGitHubOAuthProvider(config: {
	clientId: string;
	clientSecret: string;
	fetcher?: typeof fetch;
	trustedUserInfo: (
		profile: { id: unknown; [key: string]: unknown },
		emails: readonly Pick<GitHubEmail, 'email' | 'primary' | 'verified'>[]
	) => GitHubProfile;
	trustedProfile: (profile: GitHubProfile) => {
		id: string;
		githubAccountId: string;
		email: string;
		emailVerified: boolean;
		name?: string;
		image?: string;
	};
}): ReturnType<typeof GitHub>;
