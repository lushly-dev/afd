/**
 * @fileoverview Who can reach a secret file, the TLS key or the data directory on Windows (3.2's row for
 * `HOST_SECRET_PERMISSIONS`): its ACL, read for every path of one check in one PowerShell call, and judged
 * by SID, never by account name. POSIX reads the mode bits instead (`secrets.ts`).
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { HostFinding } from './errors.js';

/** NT AUTHORITY\SYSTEM. */
export const SYSTEM_SID = 'S-1-5-18';
/** BUILTIN\Administrators. */
export const ADMINISTRATORS_SID = 'S-1-5-32-544';

/**
 * The rights that read or change a file (or list or add to a directory), or let their holder grant
 * themselves those: read, write and append data, change permissions, take ownership, and generic read,
 * write and all. POSIX's 0o077 likewise refuses any group or other access, write included.
 */
export const ACCESS_RIGHTS =
	0x1 | 0x2 | 0x4 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000 | 0x80000000;

/** One access control entry, its rights as the 32 bits of its mask. */
export interface AclEntry {
	readonly sid: string;
	readonly allow: boolean;
	readonly rights: number;
}

/** One path's ACL as read, or why it could not be. */
export type AclRead =
	| { readonly state: 'missing' }
	| { readonly state: 'read'; readonly owner: string; readonly aces: readonly AclEntry[] }
	| { readonly state: 'failed'; readonly reason: string };

/** One check's reads, in the order of its paths, and the SID of the account the check runs as. */
export interface AclReport {
	readonly user?: string;
	readonly reads: readonly AclRead[];
}

export interface AccessRequest {
	readonly path: string;
	readonly key: string;
	readonly kind: 'file' | 'directory';
}

/**
 * The SIDs beyond the owner, SYSTEM and Administrators that an allow entry grants read or more. Deny
 * entries never make a path public; inherited and inherit-only entries count as explicit ones do, since an
 * inheritable grant on the data directory reaches every file written into it.
 */
export function exposedTo(read: { owner: string; aces: readonly AclEntry[] }): string[] {
	const allowed = new Set([read.owner, SYSTEM_SID, ADMINISTRATORS_SID]);
	const exposed = read.aces
		.filter((ace) => ace.allow && (ace.rights & ACCESS_RIGHTS) !== 0 && !allowed.has(ace.sid))
		.map((ace) => ace.sid);
	return [...new Set(exposed)];
}

/** The finding for one path's read: none when it is missing or private, a refusal otherwise. */
export function aclFinding(
	read: AclRead,
	request: AccessRequest,
	user: string | undefined
): HostFinding | undefined {
	const { path, key, kind } = request;
	if (read.state === 'missing') return undefined;
	if (read.state === 'failed' || user === undefined) {
		const reason = read.state === 'failed' ? read.reason : 'the account it runs as is unknown';
		return {
			code: 'HOST_SECRET_PERMISSIONS',
			key,
			message: `\`${key}\`'s access cannot be read on Windows (${reason}), so it is refused.`,
			suggestion: `Check that \`powershell.exe\` runs and that this account can read the permissions of \`${path}\`.`,
		};
	}
	const exposed = exposedTo(read);
	if (exposed.length === 0) return undefined;
	const grant = kind === 'directory' ? '(OI)(CI)(F)' : '(F)';
	const remove = exposed.map((sid) => `*${sid}`).join(' ');
	return {
		code: 'HOST_SECRET_PERMISSIONS',
		key,
		message: `\`${path}\` grants ${exposed.join(', ')} access beyond its owner, SYSTEM and Administrators.`,
		suggestion: `Run \`icacls "${path}" /inheritance:r /grant:r "*${user}:${grant}" /remove:g ${remove}\`.`,
	};
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function parseRead(value: unknown): AclRead | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const read = value as Record<string, unknown>;
	if (read.state === 'missing') return { state: 'missing' };
	if (read.state === 'failed')
		return { state: 'failed', reason: isText(read.reason) ? read.reason : 'unknown error' };
	if (read.state !== 'read' || !isText(read.owner) || !Array.isArray(read.aces)) return undefined;
	const aces: AclEntry[] = [];
	for (const entry of read.aces as unknown[]) {
		if (typeof entry !== 'object' || entry === null) return undefined;
		const { sid, allow, rights } = entry as Record<string, unknown>;
		if (!isText(sid) || typeof allow !== 'boolean' || !Number.isInteger(rights)) return undefined;
		aces.push({ sid, allow, rights: (rights as number) | 0 });
	}
	return { state: 'read', owner: read.owner, aces };
}

/** Every path read as failed, for a call whose output cannot be trusted. */
export function failedReport(count: number, reason: string): AclReport {
	return { reads: Array.from({ length: count }, () => ({ state: 'failed', reason }) as const) };
}

/** The PowerShell call's output for `count` paths; anything malformed fails every path closed. */
export function parseAclReport(stdout: string, count: number): AclReport {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return failedReport(count, 'PowerShell answered no ACL report');
	}
	const report = (parsed ?? {}) as Record<string, unknown>;
	const reads = Array.isArray(report.reads) ? report.reads.map(parseRead) : [];
	if (!isText(report.user) || reads.length !== count || reads.some((read) => read === undefined)) {
		return failedReport(count, 'PowerShell answered a malformed ACL report');
	}
	return { user: report.user, reads: reads as AclRead[] };
}

/**
 * Reads `LOAM_ACL_PATHS`, a JSON array, so no path is ever part of the command's text. `GetAccessRules`
 * with `SecurityIdentifier` names each principal by SID; `[int]` keeps a mask's 32 bits.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$sid = [System.Security.Principal.SecurityIdentifier]
$paths = ConvertFrom-Json $env:LOAM_ACL_PATHS
$reads = @(foreach ($p in $paths) {
	try {
		if (-not (Test-Path -LiteralPath $p)) { @{ state = 'missing' } }
		else {
			$acl = Get-Acl -LiteralPath $p
			$aces = @(foreach ($r in $acl.GetAccessRules($true, $true, $sid)) {
				@{ sid = $r.IdentityReference.Value; allow = ($r.AccessControlType -eq 'Allow'); rights = [int]$r.FileSystemRights }
			})
			@{ state = 'read'; owner = $acl.GetOwner($sid).Value; aces = $aces }
		}
	} catch { @{ state = 'failed'; reason = $_.Exception.Message } }
})
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
ConvertTo-Json -Compress -Depth 5 -InputObject @{ user = $user; reads = $reads }
`;

/** Windows PowerShell from the system directory, never one found first on PATH. */
function powershell(): string {
	const root = process.env.SystemRoot;
	return root
		? join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
		: 'powershell.exe';
}

/** Reads every path's ACL in one PowerShell call. A call that fails fails every path closed. */
export function readAcls(paths: readonly string[]): AclReport {
	if (paths.length === 0) return { reads: [] };
	let stdout: string;
	try {
		stdout = execFileSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
			env: { ...process.env, LOAM_ACL_PATHS: JSON.stringify(paths) },
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 60_000,
			windowsHide: true,
		});
	} catch (cause) {
		const first = String((cause as Error).message ?? cause).split(/\r?\n/)[0];
		return failedReport(paths.length, `PowerShell failed: ${first}`);
	}
	return parseAclReport(stdout, paths.length);
}

/** One finding or none per request, from one PowerShell call. */
export function aclFindings(requests: readonly AccessRequest[]): Array<HostFinding | undefined> {
	const report = readAcls(requests.map(({ path }) => path));
	return requests.map((request, index) =>
		aclFinding(
			report.reads[index] ?? { state: 'failed', reason: 'no ACL was read' },
			request,
			report.user
		)
	);
}
