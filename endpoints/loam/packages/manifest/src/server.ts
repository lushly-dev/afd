/**
 * @fileoverview `@lushly-dev/loam-manifest/server`: `loam.server.toml`'s reader (phase 6 specification,
 * 3.2), for the hosted server only. Nothing a page loads imports it, so its validator and the Public
 * Suffix List stay out of every browser chunk.
 */

export {
	isLoopbackHost,
	readServerConfig,
	SERVER_ADMITTED_KEYS_V1,
	SERVER_DISCOVERY_V1,
	SERVER_LIMITS_V1,
	type ServerConfigRead,
	type ServerConfigRefusal,
	type ServerConfigRefusalCode,
	type ServerConfigV1,
	type ServerDiscoveryV1,
	type ServerLimitsV1,
	siteOf,
	splitListen,
} from './read-server.js';
