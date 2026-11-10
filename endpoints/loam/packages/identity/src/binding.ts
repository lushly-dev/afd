/**
 * @fileoverview The workspace bound to an organization (phase 3 specification, 2.3; D85): the id pinned
 * server-side at first binding, in `loamServerPlugin`'s own table, and every membership read named by
 * that id. A slug that later points elsewhere grants nothing.
 */

import { createHash } from 'node:crypto';
import { loamRole } from './roles.js';

/** The plugin's table, by its schema name, and its rows. */
export const BINDING_MODEL = 'loamBinding';

export interface LoamBindingV1 {
	/** The workspace's id, one binding each. */
	workspace: string;
	/** The bound organization's id: never its slug. */
	organizationId: string;
	boundAt: Date;
}

/** An organization as a person's membership names it. */
export interface BoundOrganizationV1 {
	id: string;
	slug: string;
	name: string;
}

/** A person's membership of the bound organization, as `whoami` answers it (4.2). */
export interface MembershipRowV1 {
	organization: BoundOrganizationV1;
	role: 'owner' | 'admin' | 'member';
	/** Changes whenever the person's membership does: their member row, its role, the organization. */
	digest: string;
}

/** What `bindOrganization` and the binding endpoint report. */
export type BindingStatusV1 =
	| {
			binding: LoamBindingV1;
			organization: BoundOrganizationV1 | null;
			/** The deployment file's slug no longer names the bound organization (2.3), or it is gone. */
			warning?: 'IDENTITY_BINDING_MISMATCH';
	  }
	| { binding: null; organization: null; warning: 'IDENTITY_ORGANIZATION_UNKNOWN' };

type Where = { field: string; value: string }[];

/** The slice of Better Auth's database adapter the binding reads and writes. */
export interface BindingAdapter {
	findOne<T>(query: { model: string; where: Where }): Promise<T | null>;
	findMany<T>(query: { model: string; where?: Where }): Promise<T[]>;
	create<T extends Record<string, unknown>>(query: { model: string; data: T }): Promise<unknown>;
}

interface OrganizationRow extends BoundOrganizationV1 {}
interface MemberRow {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
}

export const readBinding = (adapter: BindingAdapter, workspace: string) =>
	adapter.findOne<LoamBindingV1>({
		model: BINDING_MODEL,
		where: [{ field: 'workspace', value: workspace }],
	});

const organizationById = (adapter: BindingAdapter, id: string) =>
	adapter.findOne<OrganizationRow>({ model: 'organization', where: [{ field: 'id', value: id }] });

const shown = ({ id, slug, name }: OrganizationRow): BoundOrganizationV1 => ({ id, slug, name });

/**
 * Pin the binding on the hosted server's first start, and report it on every later one (2.3): the
 * deployment file's `[identity] organization` slug resolved to the organization's id and written with
 * the workspace, once. From then on the slug is only checked: one that no longer names the bound
 * organization is `IDENTITY_BINDING_MISMATCH`, a warning, and nothing rebinds. No organization with the
 * slug yet (before `bootstrapOrganization`) is `IDENTITY_ORGANIZATION_UNKNOWN`, and nothing is pinned.
 * Rebinding is a deployer's act on the server's database, never a command.
 */
export async function bindOrganization(
	adapter: BindingAdapter,
	config: { workspace: string; organization: string },
	now: () => Date = () => new Date()
): Promise<BindingStatusV1> {
	const held = await readBinding(adapter, config.workspace);
	if (held) return statusOf(adapter, held, config.organization);
	const found = await adapter.findOne<OrganizationRow>({
		model: 'organization',
		where: [{ field: 'slug', value: config.organization }],
	});
	if (!found)
		return { binding: null, organization: null, warning: 'IDENTITY_ORGANIZATION_UNKNOWN' };
	const binding: LoamBindingV1 = {
		workspace: config.workspace,
		organizationId: found.id,
		boundAt: now(),
	};
	await adapter.create({ model: BINDING_MODEL, data: { ...binding } });
	return { binding, organization: shown(found) };
}

/** The binding as it stands: its organization now, and whether the deployment's slug still names it. */
export async function statusOf(
	adapter: BindingAdapter,
	binding: LoamBindingV1,
	slug: string
): Promise<BindingStatusV1> {
	const organization = await organizationById(adapter, binding.organizationId);
	return organization && organization.slug === slug
		? { binding, organization: shown(organization) }
		: {
				binding,
				organization: organization ? shown(organization) : null,
				warning: 'IDENTITY_BINDING_MISMATCH',
			};
}

/** A digest of one person's membership, which changes with their member row, its role or its organization. */
export const membershipDigest = (organizationId: string, member: MemberRow): string =>
	createHash('sha256')
		.update(JSON.stringify([organizationId, member.id, member.userId, member.role]))
		.digest('hex');

/**
 * A person's membership of the bound organization, by the bound id and never a slug or a session's active
 * organization (2.3): null with no binding, no member row, or no organization.
 */
export async function membershipOf(
	adapter: BindingAdapter,
	workspace: string,
	person: string
): Promise<MembershipRowV1 | null> {
	const binding = await readBinding(adapter, workspace);
	if (!binding) return null;
	const member = await adapter.findOne<MemberRow>({
		model: 'member',
		where: [
			{ field: 'organizationId', value: binding.organizationId },
			{ field: 'userId', value: person },
		],
	});
	const organization = member && (await organizationById(adapter, binding.organizationId));
	if (!member || !organization) return null;
	return {
		organization: shown(organization),
		role: loamRole(member.role),
		digest: membershipDigest(binding.organizationId, member),
	};
}
