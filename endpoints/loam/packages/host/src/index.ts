/**
 * @fileoverview `@lushly-dev/loam-host`: Loam's hosted server (phase 6 specification, section 3). Server
 * only: nothing in `web`, `chrome` or `kernel` imports it.
 */

export {
	type CheckHostOptions,
	checkHost,
	HOST_ROUTE_SEGMENTS,
	type HostCheck,
	type HostKind,
	hostKindOf,
	hostRouteSegments,
} from './check.js';
export { type HostCliIO, runHostCli } from './cli.js';
export { hostCheckCommand, hostDoctorCommand } from './commands.js';
export { type LoadedServerConfig, loadServerConfig, withAbsolutePaths } from './config.js';
export { PUBLIC_DIRECTORY, SITE_DIRECTORY } from './data.js';
export { BACKUP_FILES, type DataFile, type DoctorReport, doctorReport } from './doctor.js';
export { HostError, type HostErrorCode, type HostFinding } from './errors.js';
export {
	commonHeaders,
	FORM_ACTION_SELF,
	FRAME_ANCESTORS_NONE,
	INERT_HTML_POLICY,
	isFormPage,
	type MetaPolicy,
	metaPolicy,
	SHELL_PERMISSIONS_POLICY,
	sandboxPolicy,
	shellPagePolicy,
	siteCacheControl,
} from './headers.js';
export { createLoamHost, type LoamHost, type LoamHostConfig } from './host.js';
export {
	type DataLock,
	LOCK_FILE,
	LOCK_INFO_FILE,
	LOCK_STATEMENTS,
	type LockInfo,
	readLockInfo,
} from './lock.js';
export {
	acceptsHtml,
	type ServeSiteOptions,
	type SiteAnswer,
	type SiteRequest,
	serveSite,
	sitePath,
} from './site.js';
