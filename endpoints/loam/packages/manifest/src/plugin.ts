/**
 * @fileoverview `@lushly-dev/loam-manifest/plugin`: a plugin bundle's manifest (phase 5 no-terminal amendment, 4.2 and
 * 4.4; D166), for `loam plugin check` and `loam plugin pack`. Nothing a page loads imports it, so its validator stays
 * out of every browser chunk.
 */

export {
	BUNDLE_PATH_MAX_BYTES,
	BUNDLE_SEGMENT_MAX_BYTES,
	bundlePathProblem,
	foldBundlePath,
	isReservedPluginName,
	PLUGIN_ADMITTED_KEYS_V1,
	PLUGIN_FORBIDDEN_KEYS_V1,
	PLUGIN_TARGETS_V1,
	type PluginManifestRead,
	type PluginManifestV1,
	type PluginRefusal,
	type PluginRefusalCode,
	type PluginTargetV1,
	pluginAppsRefusals,
	readPluginManifest,
} from './read-plugin.js';
