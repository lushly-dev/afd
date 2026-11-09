/**
 * @fileoverview The readers' result types and every code a refusal or warning can carry (phase 1
 * specification, 2.5).
 */

import type {
	DeploymentV1,
	DeploymentV2,
	ManifestV1,
	ManifestV2,
	ProjectionV1,
	ProjectionV2,
} from './_generated/types.js';

export type { DeploymentV1, DeploymentV2, ManifestV1, ManifestV2, ProjectionV1, ProjectionV2 };

/** One entry of a projection. Version 2's entry is version 1's with its boot record. */
export type ProjectionAppV1 = ProjectionV1['apps'][number];

/** One entry of a version 2 projection (phase 2 specification, 2.2). */
export type ProjectionAppV2 = ProjectionV2['apps'][number];

/** What an entry's boot record says, for display only. */
export type ProjectionBootV2 = NonNullable<ProjectionAppV2['boot']>;

/** A projection entry of a mounted instance. */
export type ProjectionMountedV1 = ProjectionAppV1 & { prefix: string; transport: 'http' | 'stdio' };

/** A code a manifest's refusal or warning can carry. */
export type ManifestRefusalCode =
	| 'BINDING_MODEL_UNAVAILABLE'
	| 'DOCUMENT_COMMAND_INVALID'
	| 'DOCUMENT_SCOPE_INVALID'
	| 'DOCUMENT_TEMPLATE_INVALID'
	| 'DOCUMENT_TYPE_ID_INVALID'
	| 'MANIFEST_AFD_CONTRACT'
	| 'MANIFEST_APPROVAL_UNAVAILABLE'
	| 'MANIFEST_BUDGET_INVALID'
	| 'MANIFEST_BUDGET_UNAVAILABLE'
	| 'MANIFEST_COMMAND_NEEDS_INPUT'
	| 'MANIFEST_COMMAND_UNKNOWN'
	| 'MANIFEST_COMPOSITION_INCOMPLETE'
	| 'MANIFEST_COMPOSITION_UNAVAILABLE'
	| 'MANIFEST_COMPOSITION_UNKNOWN'
	| 'MANIFEST_CONFIG_SCHEMA_INVALID'
	| 'MANIFEST_CONFIRM_UNAVAILABLE'
	| 'MANIFEST_CONTEXT_UNDECLARED'
	| 'MANIFEST_DOCUMENT_BINDING'
	| 'MANIFEST_DOMAIN_INVALID'
	| 'MANIFEST_DUPLICATE'
	| 'MANIFEST_EFFECT_REFUSED'
	| 'MANIFEST_ELEMENT_INVALID'
	| 'MANIFEST_FILE_MISSING'
	| 'MANIFEST_ID_RESERVED'
	| 'MANIFEST_INPUT_SCHEMA_INVALID'
	| 'MANIFEST_INVALID'
	| 'MANIFEST_KEY_REFUSED'
	| 'MANIFEST_KIND_UNKNOWN'
	| 'MANIFEST_LAYOUT_INVALID'
	| 'MANIFEST_MOUNT_PREFIX'
	| 'MANIFEST_NAME_DOMAIN'
	| 'MANIFEST_NOT_PACKED'
	| 'MANIFEST_PATH_ESCAPE'
	| 'MANIFEST_REQUIRES_UNKNOWN'
	| 'MANIFEST_RESERVED_KEY'
	| 'MANIFEST_RESOURCE_KEY_INVALID'
	| 'MANIFEST_RESOURCE_UNKNOWN'
	| 'MANIFEST_SECTION_KIND'
	| 'MANIFEST_SKILL_NAME'
	| 'MANIFEST_SUMMARY_INVALID'
	| 'MANIFEST_SURFACE_KIND'
	| 'MANIFEST_SURFACE_UNAVAILABLE'
	| 'MANIFEST_TEXT_INVALID'
	| 'MANIFEST_TOOL_META_INVALID'
	| 'MANIFEST_UNKNOWN_KEY'
	| 'MANIFEST_UNKNOWN_SURFACE'
	| 'MANIFEST_VERSION_UNSUPPORTED'
	| 'GRANT_NOT_APPLICABLE'
	| 'GRANT_REQUIRED'
	| 'GRANT_UNAVAILABLE'
	| 'GRANT_UNKNOWN'
	| 'KEYBINDING_RESERVED'
	| 'VIEW_CSP_IGNORED';

/** A code a deployment file's or a projection's refusal can carry. */
export type DeploymentRefusalCode =
	| 'DEPLOYMENT_AUDIENCE_REQUIRED'
	| 'DEPLOYMENT_BASE_PATH_INVALID'
	| 'DEPLOYMENT_CREDENTIAL_CONFLICT'
	| 'DEPLOYMENT_EXPOSE_UNAVAILABLE'
	| 'DEPLOYMENT_INSTANCE_MISMATCH'
	| 'DEPLOYMENT_INSTANCE_RESERVED'
	| 'DEPLOYMENT_INVALID'
	| 'DEPLOYMENT_PROJECT_INVALID'
	| 'DEPLOYMENT_TEAM_NEEDS_HTTP'
	| 'DEPLOYMENT_TRANSPORT_KEYS'
	| 'DEPLOYMENT_URL_INVALID'
	| 'DEPLOYMENT_VERSION_UNSUPPORTED'
	| 'DEPLOYMENT_WORKSPACE_INVALID';

/** One refusal or warning. It names the key and gives a suggestion (P5). */
export interface Refusal<Code extends string> {
	code: Code;
	/** The key as an author reads it: 'ui.surfaces.tray', 'commands[0].expose.pallete'. */
	key: string;
	message: string;
	suggestion: string;
}

export type ManifestRefusal = Refusal<ManifestRefusalCode>;
export type DeploymentRefusal = Refusal<DeploymentRefusalCode>;

export type ManifestRead =
	| { ok: true; manifest: ManifestV2; warnings: ManifestRefusal[] }
	| { ok: false; refusals: ManifestRefusal[]; warnings: ManifestRefusal[] };

/** A deployment's workspace (phase 2 specification, 4.2). */
export interface DeploymentWorkspaceV2 {
	id: string;
	name: string;
}

export type DeploymentRead =
	| {
			ok: true;
			deployment: DeploymentV1 | DeploymentV2;
			/** The file's, or `personal` for a version 1 file or one that names none. */
			workspace: DeploymentWorkspaceV2;
			/** `site.base_path`, or `/`. */
			basePath: string;
			warnings: DeploymentRefusal[];
	  }
	| { ok: false; refusals: DeploymentRefusal[]; warnings: DeploymentRefusal[] };

export type ProjectionRead =
	| { ok: true; projection: ProjectionV2; warnings: DeploymentRefusal[] }
	| { ok: false; refusals: DeploymentRefusal[]; warnings: DeploymentRefusal[] };
