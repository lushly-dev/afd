/**
 * @fileoverview The provider's roles as Loam reads them (phase 3 specification, 7.1 and 7.5; D96): the
 * organization plugin's `owner`, `admin` and `member`, with access control of Loam's own. `owner` and
 * `admin` hold the same member and invitation powers, since both are Loam owners; no role may update or
 * delete the organization, so the bound organization cannot be moved from under the workspace; and no role
 * holds teams or dynamic access control, which Loam does not use.
 */

import { createAccessControl } from 'better-auth/plugins/access';

/** What the organization plugin checks: only members and invitations are granted to anyone. */
const statements = {
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['create', 'read', 'update', 'delete'],
} as const;

export const loamAccessControl = createAccessControl(statements);

const owners = {
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
} as const;

/**
 * The three roles. An `admin` holds every member and invitation power an `owner` holds (D96); what
 * remains the provider's `owner`'s alone, granting or removing that role and leaving the organization
 * ownerless, Better Auth checks itself and Loam's hooks check again (7.5).
 */
export const loamRoles = {
	owner: loamAccessControl.newRole(owners),
	admin: loamAccessControl.newRole(owners),
	member: loamAccessControl.newRole({}),
};

/** A role string as the organization plugin stores it: one role, or several joined by commas. */
export const rolesOf = (role: string | null | undefined): string[] =>
	(role ?? '').split(',').map((part) => part.trim());

/** Whether a member row's role makes its person a Loam owner: `owner` or `admin` (D96). */
export const isOwnerRole = (role: string | null | undefined): boolean =>
	rolesOf(role).some((part) => part === 'owner' || part === 'admin');

/** The role a person holds in Loam's three: `owner` before `admin` before `member`. */
export function loamRole(role: string | null | undefined): 'owner' | 'admin' | 'member' {
	const held = rolesOf(role);
	return held.includes('owner') ? 'owner' : held.includes('admin') ? 'admin' : 'member';
}
