/**
 * @fileoverview The records of the workspace and project stores (phase 2 specification, 4.1 and 4.3).
 * Types only, so first paint holds none of it.
 */

import type { ScopeV1 } from '@lushly-dev/loam-sdk';

export type { ScopeV1 };

/** The `workspace` table's one row (D73). */
export interface WorkspaceV1 {
	/** And its slug: `^[a-z0-9][a-z0-9-]{0,62}$`. */
	id: string;
	name: string;
	/** The projection's, once applied. */
	generation: string;
	/** Default 30; the documents specification's trash. */
	trashDays: number;
	/** Reserved: phase 3 (R10). */
	organization: null;
	/** Reserved (D32). */
	tenant: null;
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
}

/** One entry of the projection, kept. Never a location, a credential or a command line (D63). */
export interface WorkspaceAppV1 {
	/** The instance. */
	id: string;
	workspace: string;
	app: string;
	package: string;
	config?: Record<string, unknown>;
	prefix?: string;
	audience?: 'team' | 'person';
	transport?: 'http' | 'stdio';
	route?: string;
	projects?: string[];
	space?: Record<string, string>;
	expose?: Record<string, boolean>;
	commands?: Record<string, unknown>;
	order?: number;
	title?: string;
	/** What a person changed, which outlives the next deployment. */
	overrides: { enabled?: boolean; order?: number; title?: string };
	/** The generation that last listed it, or null once it stopped. */
	listed: string | null;
	updatedAt: number;
	updatedBy: string;
}

/** Who may enter a project (phase 2 specification, 4.3). */
export type ProjectAccessV1 = { mode: 'workspace' } | { mode: 'restricted'; members: string[] };

/** One row of the `project` table (phase 2 specification, 4.3). */
export interface ProjectV1 {
	/** `prj_` and ten characters. */
	id: string;
	workspace: string;
	/** Unique, not `all`, and fixed once created. */
	slug: string;
	/** 1 to 80 characters. */
	name: string;
	icon: string;
	status: 'active' | 'archived';
	access: ProjectAccessV1;
	/** Raised when `access` changes. Unused until the collaboration service (D46). */
	memberEpoch: number;
	createdAt: number;
	updatedAt: number;
	createdBy: string;
	updatedBy: string;
}

/** What the active scope changed from and to, in one call (phase 2 specification, 11.1). */
export interface ScopeChangeV2 {
	from: ScopeV1;
	to: ScopeV1;
	/** The instance a switch left, if any. */
	left?: string;
	reason: 'scope-set' | 'document-open' | 'project-archive' | 'actor';
}

/** The store tables (phase 2 specification, section 4). */
export const WORKSPACE_TABLE = 'workspace';
export const WORKSPACE_APP_TABLE = 'workspace-app';
export const PROJECT_TABLE = 'project';

/** One row of the `agent-member` table (phase 3 specification, 8.1): an agent with no account at the provider. */
export interface AgentMemberV1 {
	/** `agt_` and 20 characters of `[a-z0-9]`. */
	id: string;
	workspace: string;
	/** The kernel's table holds `installed`; a `connected` one lives in the provider's database (9.2). */
	kind: 'installed' | 'connected';
	/** 1 to 80; for `connected`, the client's self-asserted name. */
	name: string;
	/** Up to 500. */
	description?: string;
	/** A person member's id: the agent's `onBehalfOf`. */
	sponsor: string;
	/** The owner who added it, or for `connected` the person who connected it (D98). */
	installedBy: string;
	/** `connected` only: the OAuth client id and its metadata document's host. */
	client?: { id: string; host: string };
	/** Default `{ workspace: false, projects: [] }`; `'sponsor'` is whatever the sponsor may enter. */
	access: { workspace: boolean; projects: string[] | 'sponsor' };
	/** Up to 8 KiB; read by phase 5. */
	guidance?: string;
	status: 'pending' | 'active' | 'suspended';
	suspended?: 'sponsor-left' | 'sponsor-declined' | 'disconnected' | 'owner';
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
}

/** One row of the `persona` table (phase 3 specification, 6.1): a person's lens, never a grant. */
export interface PersonaV1 {
	/** `per_` and 16 characters of `[a-z0-9]`. */
	id: string;
	workspace: string;
	/** Never an agent. */
	person: string;
	/** 1 to 40: what the switch shows. */
	title: string;
	presentation: { name?: string; pronouns?: string; avatar?: string };
	defaults: {
		landing?: { section: 'projects' | 'documents' } | { app: string };
		project?: string | null;
		density?: string;
		theme?: string;
	};
	emphasis: { apps?: string[]; sections?: ('projects' | 'documents' | 'account')[] };
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
}
