import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	type AccessRequest,
	type AclEntry,
	type AclRead,
	ADMINISTRATORS_SID,
	aclFinding,
	exposedTo,
	failedReport,
	parseAclReport,
	readAcls,
	SYSTEM_SID,
} from './acl.js';
import { loosen, temporaryDirectory, USERS_SID } from './test-support.js';

const OWNER = 'S-1-5-21-1000-2000-3000-1001';
const OTHER_USER = 'S-1-5-21-1000-2000-3000-1002';
const EVERYONE = 'S-1-1-0';
const FULL = 2032127;
const READ = 1179785;
const GENERIC_READ = 0x80000000 | 0;
const GENERIC_ALL = 0x10000000;
const WRITE_ONLY = 0x2 | 0x4;
const GENERIC_WRITE = 0x40000000;
const READ_ATTRIBUTES = 0x80;

const allow = (sid: string, rights = READ): AclEntry => ({ sid, allow: true, rights });
const deny = (sid: string, rights = FULL): AclEntry => ({ sid, allow: false, rights });
const read = (...aces: AclEntry[]): AclRead => ({ state: 'read', owner: OWNER, aces });

const FILE: AccessRequest = { path: 'secrets\\auth', key: 'auth', kind: 'file' };
const DIRECTORY: AccessRequest = { path: 'data', key: 'data', kind: 'directory' };
const PRIVATE = [allow(SYSTEM_SID, FULL), allow(ADMINISTRATORS_SID, FULL), allow(OWNER, FULL)];

describe('the Windows ACL check (3.2, HOST_SECRET_PERMISSIONS)', () => {
	it('takes an ACL granting only the owner, SYSTEM and Administrators', () => {
		expect(exposedTo({ owner: OWNER, aces: PRIVATE })).toEqual([]);
		expect(aclFinding(read(...PRIVATE), FILE, OWNER)).toBeUndefined();
		expect(aclFinding(read(), FILE, OWNER)).toBeUndefined();
	});

	it('refuses an allow entry granting read or more to any other SID, naming each once', () => {
		expect(exposedTo({ owner: OWNER, aces: [...PRIVATE, allow(USERS_SID)] })).toEqual([USERS_SID]);
		expect(
			exposedTo({
				owner: OWNER,
				aces: [
					allow(EVERYONE, GENERIC_READ),
					allow(OTHER_USER, GENERIC_ALL),
					allow(EVERYONE, FULL),
					allow(USERS_SID, 0x40000),
				],
			})
		).toEqual([EVERYONE, OTHER_USER, USERS_SID]);
	});

	it('ignores deny entries and grants that neither read nor change the file', () => {
		expect(
			exposedTo({ owner: OWNER, aces: [deny(EVERYONE), allow(EVERYONE, READ_ATTRIBUTES)] })
		).toEqual([]);
	});

	it('refuses write grants as POSIX refuses group and other write', () => {
		expect(
			exposedTo({
				owner: OWNER,
				aces: [allow(USERS_SID, WRITE_ONLY), allow(EVERYONE, GENERIC_WRITE)],
			})
		).toEqual([USERS_SID, EVERYONE]);
	});

	it('takes the owner by SID, whoever it is', () => {
		expect(
			exposedTo({ owner: OTHER_USER, aces: [allow(OTHER_USER, FULL), allow(OWNER, FULL)] })
		).toEqual([OWNER]);
	});

	it('names an icacls command granting only the current user, a directory with inheritance', () => {
		const loose = read(...PRIVATE, allow(USERS_SID), allow(EVERYONE));
		expect(aclFinding(loose, FILE, OWNER)).toEqual({
			code: 'HOST_SECRET_PERMISSIONS',
			key: 'auth',
			message: `\`secrets\\auth\` grants ${USERS_SID}, ${EVERYONE} access beyond its owner, SYSTEM and Administrators.`,
			suggestion: `Run \`icacls "secrets\\auth" /inheritance:r /grant:r "*${OWNER}:(F)" /remove:g *${USERS_SID} *${EVERYONE}\`.`,
		});
		expect(aclFinding(loose, DIRECTORY, OWNER)?.suggestion).toBe(
			`Run \`icacls "data" /inheritance:r /grant:r "*${OWNER}:(OI)(CI)(F)" /remove:g *${USERS_SID} *${EVERYONE}\`.`
		);
	});

	it('leaves a missing path to the read that follows, as POSIX does', () => {
		expect(aclFinding({ state: 'missing' }, FILE, OWNER)).toBeUndefined();
	});

	it('fails closed on a failed read, or an unknown account', () => {
		const failed = aclFinding({ state: 'failed', reason: 'Access is denied' }, FILE, OWNER);
		expect(failed).toMatchObject({ code: 'HOST_SECRET_PERMISSIONS', key: 'auth' });
		expect(failed?.message).toContain('Access is denied');
		expect(aclFinding(read(...PRIVATE), FILE, undefined)).toMatchObject({
			code: 'HOST_SECRET_PERMISSIONS',
		});
	});

	it('parses the PowerShell report, keeping each mask as its 32 bits', () => {
		const stdout = JSON.stringify({
			user: OWNER,
			reads: [
				{
					state: 'read',
					owner: OWNER,
					aces: [{ sid: USERS_SID, allow: true, rights: -2147483648 }],
				},
				{ state: 'missing' },
				{ state: 'failed', reason: 'denied' },
			],
		});
		const report = parseAclReport(stdout, 3);
		expect(report.user).toBe(OWNER);
		expect(report.reads[1]).toEqual({ state: 'missing' });
		expect(report.reads[2]).toEqual({ state: 'failed', reason: 'denied' });
		const first = report.reads[0];
		expect(first?.state === 'read' && exposedTo(first)).toEqual([USERS_SID]);
	});

	it.each([
		['no JSON', 'Get-Acl : not found'],
		['too few reads', JSON.stringify({ user: OWNER, reads: [{ state: 'missing' }] })],
		['no user', JSON.stringify({ reads: [{ state: 'missing' }, { state: 'missing' }] })],
		[
			'a malformed entry',
			JSON.stringify({
				user: OWNER,
				reads: [{ state: 'read', owner: OWNER, aces: [{ sid: 1 }] }, { state: 'missing' }],
			}),
		],
	])('fails every path closed on a report with %s', (_name, stdout) => {
		const report = parseAclReport(stdout, 2);
		expect(report.reads.map((each) => each.state)).toEqual(['failed', 'failed']);
		for (const each of report.reads)
			expect(aclFinding(each, FILE, report.user)).toMatchObject({
				code: 'HOST_SECRET_PERMISSIONS',
			});
	});

	it('fails every path closed when PowerShell cannot run', () => {
		const report = failedReport(2, 'PowerShell failed: spawn ENOENT');
		expect(report.reads).toEqual([
			{ state: 'failed', reason: 'PowerShell failed: spawn ENOENT' },
			{ state: 'failed', reason: 'PowerShell failed: spawn ENOENT' },
		]);
	});

	it('reads nothing for no paths, without starting PowerShell', () => {
		expect(readAcls([])).toEqual({ reads: [] });
	});

	// The ACL is Windows' own; on POSIX the mode bits decide (`privateModeFinding`), so this test exists
	// only on Windows, rather than reporting a skip elsewhere (repository-contract.test.mjs).
	if (process.platform === 'win32')
		it('reads a private file, a loosened file, an inherited grant and a missing path in one call', async () => {
			const root = await temporaryDirectory();
			const kept = join(root, 'kept');
			const loose = join(root, "it's [loose] $PATH ;");
			await writeFile(kept, 'x');
			await writeFile(loose, 'x');
			loosen(loose);
			// An inheritable grant on a directory reaches a file made in it as an inherited entry.
			const open = join(root, 'open');
			await mkdir(open);
			execFileSync('icacls', [open, '/grant', `*${USERS_SID}:(OI)(CI)(R)`], { stdio: 'ignore' });
			await writeFile(join(open, 'inherits'), 'x');
			const report = readAcls([kept, loose, join(root, 'missing'), join(open, 'inherits')]);
			expect(report.user).toMatch(/^S-1-/);
			const [first, second, third, fourth] = report.reads;
			expect(first?.state === 'read' && exposedTo(first)).toEqual([]);
			expect(second?.state === 'read' && exposedTo(second)).toEqual([USERS_SID]);
			expect(third).toEqual({ state: 'missing' });
			expect(fourth?.state === 'read' && exposedTo(fourth)).toEqual([USERS_SID]);
		});
});
