/**
 * @fileoverview Who is an owner (phase 3 specification, 7.1; D96), in `late/` by 13's rule for the kernel's
 * row: only late commands read it, the owner commands of steps 4 and 6.
 */

import type { MembershipV1 } from './access.js';
import type { WorkspaceAppV1 } from './records.js';

/**
 * Whether `person` is a Loam owner: in `provider` mode, a member whose role is `owner` or `admin` (D96);
 * in `local` mode, every actor. The only reader of an owner's role (7.1).
 */
export const isOwner = (membership: MembershipV1, person: string | undefined): boolean => {
	if (membership.mode === 'local') return true;
	const role = person === undefined ? undefined : membership.members.get(person);
	return role === 'owner' || role === 'admin';
};

/**
 * Whether a team instance lists `slug` (phase 3 specification, 7.3; D87, D110, D154): an instance still listed whose
 * audience is `team` and whose `projects` names it. A person's own mounted instance listing a project serves that
 * person alone, so it makes nothing an owner's. The one rule for a project's create, its members and its own rows.
 */
export const teamListed = (apps: readonly WorkspaceAppV1[], slug: string): boolean =>
	apps.some(
		(app) => app.listed !== null && app.audience === 'team' && (app.projects ?? []).includes(slug)
	);
