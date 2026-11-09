/**
 * @fileoverview `@lushly-dev/loam-manifest/validate`: the readers, and the two rules a loader
 * calls directly. Each validator is generated ahead of time, so the page runs no `new Function`.
 */

export { needsInput } from './core-rules.js';
export { deriveMutation, mountCommandName } from './naming.js';
export { keyOf } from './pointers.js';
export { readCoreManifest } from './read-core-manifest.js';
export { DEFAULT_WORKSPACE_V2, readDeployment, workspaceNameOf } from './read-deployment.js';
export { readManifest } from './read-manifest.js';
export { readProjection } from './read-projection.js';
