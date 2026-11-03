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
