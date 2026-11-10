/**
 * @fileoverview The hosted server's codes (phase 6 specification, section 16) and its findings: what
 * `createLoamHost` refuses to construct with, and what `loam-host check` reports.
 */

import type { ServerConfigRefusalCode } from '@lushly-dev/loam-manifest/server';

/** Every code this package raises. Step 1 raises the codes of 3.2, 3.3 and section 4 it builds. */
export type HostErrorCode =
	| ServerConfigRefusalCode
	| 'HOST_SECRET_PERMISSIONS'
	| 'HOST_OIDC_INVALID'
	| 'HOST_DEPLOYMENT_KIND'
	| 'HOST_IDENTITY_LOCAL'
	| 'HOST_DATA_LOCKED'
	| 'HOST_ORIGIN_SHARED'
	| 'HOST_MISDIRECTED'
	| 'HOST_DIST_INVALID';

/** A refusal or warning, keyed as `loam deployment check` keys its findings. */
export interface HostFinding {
	/** A host code, or a deployment code from `@lushly-dev/loam-cli`'s analysis. */
	code: string;
	/** The key or path the finding is about: `origin`, `sandbox.origin`, `--dist`, a file. */
	key: string;
	message: string;
	suggestion: string;
}

/** What `createLoamHost` throws when it refuses to construct: the first refusal's code, and all of them. */
export class HostError extends Error {
	readonly code: string;
	readonly suggestion: string;
	readonly refusals: readonly HostFinding[];

	constructor(refusals: readonly HostFinding[]) {
		const first = refusals[0] as HostFinding;
		super(
			refusals.length === 1
				? first.message
				: `${refusals.length} refusals. The first, at ${first.key}: ${first.message}`
		);
		this.name = 'HostError';
		this.code = first.code;
		this.suggestion = first.suggestion;
		this.refusals = refusals;
	}
}
