/**
 * @fileoverview The hosted server's kernel (phase 3 specification, 9.2 and 9.5; step 7): `createServerKernel`, over
 * `createKernelParts({ gate: 'principal', auth: createNoSessionAdapter() })`, so no call on it runs as whoever an
 * adapter signed in, and every call, top-level or nested, runs under the request's principal. Phase 6's step 4 mounts
 * it on the hosted server with its store, journal and lock; this step builds and proves it.
 *
 * - **`createNoSessionAdapter`** is always `unauthenticated` and nothing reads it: a token's call has no session.
 * - **The account capability by person** (9.2: "served for the token's person with no session"): `account-get`,
 *   `member-list` and `agent-member-list` read the provider's database by `principal.person`, through the same
 *   functions its session endpoints use, never a session. What changes a person's account is a human command, not
 *   served over MCP, so the server's capability refuses it.
 */

import type { AuthAdapter, AuthSessionState } from '@lushly-dev/afd-auth';
import type { CommandMiddleware } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import {
	createKernelParts,
	type KernelParts,
	type KernelPartsOptions,
	type LoamAccountAccessV1,
	type LoamAuthAdapter,
} from '@lushly-dev/loam-kernel';
import {
	type ConnectionAdapter,
	connectedAgentOf,
	connectedAgentRows,
} from './connected-agents.js';
import { createMcpAuth, credentialsGate, type McpProviderV1 } from './mcp.js';
import { type Reads, readAccount, readInvitations, readMembers } from './members.js';

const SIGNED_OUT: AuthSessionState = Object.freeze({
	status: 'unauthenticated',
}) as AuthSessionState;

/** Why the server's adapter cannot sign anyone in: a token's call carries its person, never a session. */
const noSession = () =>
	Object.assign(new Error('The server kernel has no session: a call carries its own principal'), {
		code: 'UNAUTHORIZED',
		suggestion: 'Call the hosted server with a bearer token; a person signs in in the browser',
	});

/** The server's adapter (9.5): always `unauthenticated`, never signs in, and hears nothing. */
export function createNoSessionAdapter(): AuthAdapter {
	return {
		async signIn() {
			throw noSession();
		},
		async signOut() {},
		getSession: () => SIGNED_OUT,
		onAuthStateChange: () => ({ unsubscribe() {} }),
	};
}

/** A refusal of a write the server does not serve: a human command, made only in a person's browser (3.4). */
const humanOnly = () =>
	Object.assign(new Error('Only a person changes their account, in the shell'), {
		code: 'HUMAN_REQUIRED',
	});

/**
 * Loam's account capability for one person, read on the server by their id (9.2): their account, the members (as a
 * member sees them, emails only to an owner), their own invitations and the workspace's connected agents. Its writes
 * refuse: each is a human command, never served over MCP.
 */
export function serverAccountAccess(
	provider: Pick<McpProviderV1, 'adapter' | 'workspace'> & { oidc?: readonly string[] },
	person: string
): LoamAccountAccessV1 {
	const deps = { workspace: provider.workspace, oidc: provider.oidc ?? [] };
	const reads = async () => (await provider.adapter()) as unknown as Reads;
	return {
		get: async () => (await readAccount(await reads(), deps, person)) as never,
		async update() {
			throw humanOnly();
		},
		members: async (page) => (await readMembers(await reads(), deps, person, page)) as never,
		async invitations() {
			const adapter = await reads();
			const user = await adapter.findOne<{ email: string; emailVerified: boolean }>({
				model: 'user',
				where: [{ field: 'id', value: person }],
			});
			return user ? ((await readInvitations(adapter, user)) as never) : [];
		},
		async agents() {
			const adapter = (await provider.adapter()) as ConnectionAdapter;
			// Only to a member, as the endpoint answers: the kernel's line 0 has refused anyone else already.
			return (await connectedAgentRows(adapter, provider.workspace)).map(connectedAgentOf) as never;
		},
		async disconnectAgent() {
			throw humanOnly();
		},
		async updateAgent() {
			throw humanOnly();
		},
		async removeAgent() {
			throw humanOnly();
		},
	};
}

export interface ServerKernelOptions extends Omit<KernelPartsOptions, 'auth' | 'gate'> {
	/** The provider: its issuer, keys, database and the workspace its binding names. */
	provider: McpProviderV1 & { oidc?: readonly string[] };
	/** The hosted server's canonical MCP URI, `https://<host><base_path>mcp`. */
	resource: string;
}

/** What the hosted server mounts: the kernel, and `createMcpHandler`'s pieces for it (9.5, 10.2 item 3). */
export interface ServerKernel {
	parts: KernelParts;
	/**
	 * The handler's `commands`, `middleware`, `contextFields` and `auth`: `credentialsGate` first, then the kernel's own
	 * chain, which opens with `principalGate`; the commands less the human and owner ones (9.5). Undefined until stage B
	 * has loaded, which it has once `createServerKernel` resolves.
	 */
	mcp(): {
		commands: readonly ZodCommandDefinition[];
		middleware: CommandMiddleware[];
		contextFields: NonNullable<ReturnType<KernelParts['mcpOptions']>>['contextFields'];
		auth: ReturnType<typeof createMcpAuth>;
	};
}

/**
 * The hosted server's kernel (9.5): `identity` required and `mode: 'provider'`, so line 0 can never read everyone as a
 * member and owner; the principal gate on every registry; the no-session adapter, with the account capability read by
 * each call's person.
 *
 * @throws Error `IDENTITY_MODE_INVALID` for any identity but `provider`
 */
export async function createServerKernel(options: ServerKernelOptions): Promise<ServerKernel> {
	if (options.identity?.mode !== 'provider') {
		throw Object.assign(new Error("The server's kernel serves a `provider` deployment only"), {
			code: 'IDENTITY_MODE_INVALID',
			suggestion: 'Set [identity] mode = "provider" in the deployment the hosted server serves',
		});
	}
	const { provider, resource, ...kernel } = options;
	// One workspace for both halves (2.3): the provider's binding names the workspace whose records the kernel holds, so
	// a membership read for one never decides a call on the other's.
	const served =
		kernel.boot?.workspace.id ??
		kernel.deployment?.workspace.id ??
		kernel.workspace?.id ??
		'personal';
	if (provider.workspace !== served) {
		throw Object.assign(
			new Error(
				`The provider's binding names workspace '${provider.workspace}', but the kernel serves '${served}'`
			),
			{
				code: 'IDENTITY_BINDING_MISMATCH',
				suggestion: "Give the provider and the kernel the deployment's one workspace id",
			}
		);
	}
	const auth: LoamAuthAdapter = {
		...createNoSessionAdapter(),
		accountFor: (person) => serverAccountAccess(provider, person),
	};
	const parts = await createKernelParts({ ...kernel, auth, gate: 'principal' });
	const admit = parts.admitPrincipal;
	if (!admit) throw new Error('The kernel was not built with its principal gate');
	return {
		parts,
		mcp() {
			const served = parts.mcpOptions();
			if (!served) throw new Error("The kernel's late commands have not loaded");
			const mutations = new Map(
				served.commands.map((command) => [command.name, command.mutation === true])
			);
			return {
				// Each served command exposed over MCP; the hosted server's own list narrows them (phase 6's step 4, D104).
				commands: served.commands.map((command) => ({
					...command,
					expose: { ...command.expose, mcp: true },
				})),
				middleware: [
					credentialsGate({ ...provider, admit, retire: parts.retirePrincipal }),
					...served.middleware,
				],
				contextFields: served.contextFields,
				auth: createMcpAuth({
					resource,
					provider,
					isMutation: (name) => mutations.get(name),
				}),
			};
		},
	};
}
