import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import {
	ConvexProvider,
	ConvexReactClient,
	useConvexAuth,
	useConvexConnectionState,
	useMutation,
	useQuery,
} from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createAuthHooks, useConvexAuthAdapter } from '../../src/react.js';
import type { AuthAdapter, AuthSessionState, SignInOutcome, User } from '../../src/types.js';

interface RuntimeConfig {
	deploymentUrl: string;
}

declare global {
	interface Window {
		__AFD_CONVEX_CONFIG__?: RuntimeConfig;
		afdConvex?: BrowserHarness;
	}
}

type EmptyArgs = Record<string, never>;
type RunArgs = { runId: string };
type ExpectedIdentity =
	| { principalKind: 'password'; email: string }
	| { principalKind: 'github-run-scoped'; email: string }
	| { principalKind: 'github-verified-primary'; email: string; githubAccountId: string };
type RecordArgs = RunArgs & { recordId: string };
type CleanupResult = { records: number; sessions: number; accounts: number; verified: boolean };
type PreflightResult = {
	enabled: boolean;
	principalId: string;
	principalKind: 'password' | 'github-run-scoped' | 'github-verified-primary';
	identityMode: 'run-scoped' | 'verified-github-account';
	revision: string;
	capabilities: string[];
};

const meQuery = makeFunctionReference<'query', EmptyArgs, User | null>('users:me');
const preflightQuery = makeFunctionReference<
	'query',
	RunArgs & { expectedIdentity: ExpectedIdentity },
	PreflightResult
>('fixtures:preflight');
const createMutation = makeFunctionReference<'mutation', RunArgs & { value: string }, string>(
	'fixtures:create'
);
const protectedQuery = makeFunctionReference<
	'query',
	RecordArgs,
	{ ok: true; value: string } | { ok: false; reason: 'UNAUTHENTICATED' | 'FORBIDDEN' }
>('fixtures:protectedRead');
const updateProfileMutation = makeFunctionReference<'mutation', RunArgs & { name: string }, null>(
	'fixtures:updateProfile'
);
const cleanupMutation = makeFunctionReference<
	'mutation',
	RunArgs & { proof: string; expectedEmail: string },
	null
>('fixtures:cleanup');
const cleanupReadbackMutation = makeFunctionReference<
	'mutation',
	RunArgs & { proof: string },
	CleanupResult
>('fixtures:cleanupReadback');

interface Snapshot {
	status: AuthSessionState['status'];
	userId?: string;
	email?: string;
	name?: string;
	sessionId?: string;
	hasExpiresAt: boolean;
	adapterStable: boolean;
	notifications: Array<{ status: string; name?: string }>;
	history: string[];
	connected: boolean;
	connectionCount: number;
}

interface BrowserHarness {
	snapshot(): Snapshot;
	register(credentials: { email: string; password: string; name: string }): Promise<void>;
	signIn(credentials: { email: string; password: string }): Promise<string>;
	signOut(): Promise<void>;
	startOAuth(provider: string, redirectTo: string): Promise<void>;
	oauthOutcome(): string | null;
	checkScopesRejected(provider: string): Promise<string>;
	preflight(runId: string, expectedIdentity: ExpectedIdentity): Promise<PreflightResult>;
	createRecord(runId: string, value: string): Promise<string>;
	protectedRead(
		runId: string,
		recordId: string
	): Promise<{ ok: true; value: string } | { ok: false; reason: string }>;
	updateProfile(runId: string, name: string): Promise<void>;
	cleanup(runId: string, expectedEmail: string): Promise<CleanupResult>;
}

// biome-ignore lint/suspicious/noConfusingVoidType: AuthAdapter keeps legacy Promise<void> assignability
function outcomeKind(outcome: SignInOutcome | void) {
	return outcome?.kind ?? 'signed-in';
}

function Harness() {
	const actions = useAuthActions();
	const me = useQuery(meQuery);
	const adapter = useConvexAuthAdapter({
		useAuthActions,
		useConvexAuth,
		meQuery: () => me,
	});
	const hooks = useMemo(() => createAuthHooks(adapter), [adapter]);
	const state = hooks.useSession();
	const connection = useConvexConnectionState();
	const createRecord = useMutation(createMutation);
	const updateProfile = useMutation(updateProfileMutation);
	const cleanup = useMutation(cleanupMutation);
	const cleanupReadback = useMutation(cleanupReadbackMutation);
	const firstAdapter = useRef<AuthAdapter>(adapter);
	const history = useRef<string[]>(['loading']);
	const notifications = useRef<Array<{ status: string; name?: string }>>([]);

	if (history.current.at(-1) !== state.status) history.current.push(state.status);

	useEffect(
		() =>
			adapter.onAuthStateChange((next) => {
				notifications.current.push({
					status: next.status,
					...(next.status === 'authenticated' ? { name: next.user.name } : {}),
				});
			}).unsubscribe,
		[adapter]
	);

	const harness = useMemo<BrowserHarness>(
		() => ({
			snapshot() {
				const current = adapter.getSession();
				return {
					status: current.status,
					...(current.status === 'authenticated'
						? {
								userId: current.user.id,
								email: current.user.email,
								name: current.user.name,
								sessionId: current.session.id,
								hasExpiresAt: current.session.expiresAt !== undefined,
							}
						: { hasExpiresAt: false }),
					adapterStable: firstAdapter.current === adapter,
					notifications: [...notifications.current],
					history: [...history.current],
					connected: connection.isWebSocketConnected,
					connectionCount: connection.connectionCount,
				};
			},
			async register({ email, password, name }) {
				await actions.signIn('password', { email, password, name, flow: 'signUp' });
			},
			async signIn({ email, password }) {
				try {
					return outcomeKind(await adapter.signIn({ method: 'credentials', email, password }));
				} catch (error) {
					return error instanceof Error && 'code' in error ? String(error.code) : 'PROVIDER_ERROR';
				}
			},
			async signOut() {
				await adapter.signOut();
			},
			async startOAuth(provider, redirectTo) {
				const outcome = await adapter.signIn({ method: 'oauth', provider, redirectTo });
				sessionStorage.setItem('afd-convex-oauth-outcome', outcomeKind(outcome));
			},
			oauthOutcome: () => sessionStorage.getItem('afd-convex-oauth-outcome'),
			async checkScopesRejected(provider) {
				try {
					await adapter.signIn({ method: 'oauth', provider, scopes: ['read:user'] });
					return 'accepted';
				} catch (error) {
					return error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
				}
			},
			preflight: (runId, expectedIdentity) =>
				client.query(preflightQuery, { runId, expectedIdentity }),
			createRecord: (runId, value) => createRecord({ runId, value }),
			protectedRead: (runId, recordId) => client.query(protectedQuery, { runId, recordId }),
			async updateProfile(runId, name) {
				await updateProfile({ runId, name });
			},
			async cleanup(runId, expectedEmail) {
				const proof = crypto.randomUUID();
				await cleanup({ runId, proof, expectedEmail });
				return await cleanupReadback({ runId, proof });
			},
		}),
		[actions, adapter, cleanup, cleanupReadback, connection, createRecord, updateProfile]
	);

	useEffect(() => {
		window.afdConvex = harness;
		return () => {
			delete window.afdConvex;
		};
	}, [harness]);

	return (
		<main>
			<h1>AFD Convex hosted auth fixture</h1>
			<output id="session" data-status={state.status}>
				{state.status === 'authenticated' ? state.user.email : state.status}
			</output>
		</main>
	);
}

const config = window.__AFD_CONVEX_CONFIG__;
if (!config?.deploymentUrl) throw new Error('Missing Convex deployment URL');
const client = new ConvexReactClient(config.deploymentUrl);

function Providers({ children }: { children: ReactNode }) {
	return (
		<ConvexProvider client={client}>
			<ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>
		</ConvexProvider>
	);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing fixture root');
createRoot(rootElement).render(
	<Providers>
		<Harness />
	</Providers>
);
