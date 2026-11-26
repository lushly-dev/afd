/**
 * @fileoverview `@lushly-dev/loam-manifest/plugin`: a plugin bundle's manifest (Loam phase 5's no-terminal amendment,
 * 4.2 and 4.4), for `@lushly-dev/loam-cli` only. Nothing a page loads imports it, so its validator stays out of every
 * browser chunk.
 */

export {
	bundlePathProblem,
	hidesFromPerson,
	PLUGIN_ADMITTED_KEYS_V1,
	PLUGIN_BUNDLE_LIMITS_V1,
	PLUGIN_MANIFEST_FILE,
	PLUGIN_SOURCE_FILE,
	PLUGIN_TARGETS_V1,
	type PluginBundleLimitsV1,
	type PluginManifestRead,
	type PluginManifestRefusal,
	type PluginManifestRefusalCode,
	type PluginManifestV1,
	type PluginTargetV1,
	readPluginManifest,
} from './read-plugin.js';
