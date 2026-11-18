/**
 * @fileoverview `@lushly-dev/loam-host`: Loam's hosted server (phase 6 specification, section 3). Server
 * only: nothing in `web`, `chrome` or `kernel` imports it.
 */

export {
	BETTER_AUTH_OVERRIDES,
	type CheckHostOptions,
	checkHost,
	environmentFindings,
	type HostCheck,
	type HostKind,
	hostKindOf,
} from './check.js';
export { type HostCliIO, runHostCli } from './cli.js';
export { hostCheckCommand, hostDoctorCommand } from './commands.js';
export { type LoadedServerConfig, loadServerConfig, withAbsolutePaths } from './config.js';
export { PUBLIC_DIRECTORY, SITE_DIRECTORY } from './data.js';
export { BACKUP_FILES, type DataFile, type DoctorReport, doctorReport } from './doctor.js';
export { HostError, type HostErrorCode, type HostFinding } from './errors.js';
export {
	COPILOT_FRAME_PATH,
	commonHeaders,
	copilotFramePolicy,
	FORM_ACTION_SELF,
	FRAME_ANCESTORS_NONE,
	INERT_POLICY,
	isCopilotFramePath,
	isFormPage,
	isScriptOrStyle,
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
