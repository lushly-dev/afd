/**
 * @fileoverview The first organization and its first owner (phase 3 specification, 5.6): with sign-up and
 * organization creation off, the deployer makes both, once, with `bootstrapOrganization`, which phase 6's hosted lane
 * exposes as a one-time server command (10.2's item 2). It creates the organization, pins the binding (2.3), and sends
 * an `owner` invitation to `ownerEmail`, which enrols through the join page as any invitation does. It refuses when a
 * binding exists, so it never moves a workspace to another organization.
 *
 * The organization is written through the provider's database adapter, not `/organization/create`: that endpoint
 * needs a creating user, whom it makes a member, and no user exists before the first owner. For the same reason the
 * owner's invitation is a join grant of Loam's own (`bootstrap`): Better Auth's invitation row names its inviter.
 */

import type { AuthContext } from 'better-auth';
import { bindOrganization, readBinding } from './binding.js';
import {
	issueJoin,
	JOIN_INVITATION_MS,
	joinLink,
	type LinkAdapter,
	newUserId,
} from './enrolment.js';
import type { LoamProviderState } from './plugin.js';

/** The organization's slug, as the deployment file's `[identity] organization` has it (2.2). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface BootstrapInputV1 {
	slug: string;
	name: string;
	ownerEmail: string;
}

export interface BootstrapResultV1 {
	organizationId: string;
	/** The owner's join grant, which the link names as `invitation`; its token is only in the email. */
	invitation: string;
	expiresAt: Date;
}

/** A Better Auth instance built from `createLoamAuthOptions`, or its context. */
type Provider = { $context: Promise<unknown> } | AuthContext;

/** The state `loamServerPlugin` keeps, found on the instance's options. */
function stateOf(context: AuthContext): LoamProviderState {
	const plugin = context.options.plugins?.find((held) => held.id === 'loam') as
		| { $state?: LoamProviderState }
		| undefined;
	if (!plugin?.$state)
		throw new Error('bootstrapOrganization needs a provider from createLoamAuthOptions');
	return plugin.$state;
}

/**
 * Create the bound organization and invite its first owner (5.6). The workspace is the one `createLoamAuthOptions`
 * was given, and `slug` must be its `[identity] organization`, so the binding it pins is the deployment's.
 *
 * @throws Error when a binding exists, an organization already has the slug, or the input is off its shape
 */
export async function bootstrapOrganization(
	provider: Provider,
	input: BootstrapInputV1
): Promise<BootstrapResultV1> {
	const context = ('$context' in provider ? await provider.$context : provider) as AuthContext;
	const state = stateOf(context);
	const email = input.ownerEmail.trim().toLowerCase();
	if (!SLUG.test(input.slug)) throw new Error(`'${input.slug}' is not an organization slug`);
	if (input.slug !== state.organization) {
		throw new Error(
			`The deployment binds '${state.organization}': bootstrap that slug, or change [identity] organization`
		);
	}
	const name = input.name.trim();
	if (name === '' || name.length > 80)
		throw new Error('An organization name is 1 to 80 characters');
	if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320)
		throw new Error('ownerEmail is not an email address');
	const adapter = context.adapter as unknown as LinkAdapter & {
		transaction<R>(run: (trx: LinkAdapter) => Promise<R>): Promise<R>;
	};
	if (await readBinding(adapter as never, state.workspace)) {
		throw new Error(
			'This workspace is already bound to an organization: a deployer rebinds it on the server'
		);
	}
	if (
		await adapter.findOne({ model: 'organization', where: [{ field: 'slug', value: input.slug }] })
	) {
		throw new Error(`An organization already has the slug '${input.slug}'`);
	}
	const now = new Date();
	const expiresAt = new Date(now.getTime() + JOIN_INVITATION_MS);
	const invitation = `boot_${newUserId(context)}`;
	const { organizationId, token } = await adapter.transaction(async (trx) => {
		const organization = await trx.create<{ id: string }>({
			model: 'organization',
			data: { name, slug: input.slug, createdAt: now },
		});
		const bound = await bindOrganization(trx as never, {
			workspace: state.workspace,
			organization: input.slug,
		});
		if (bound.binding?.organizationId !== organization.id)
			throw new Error('The binding did not pin the new organization');
		const token = await issueJoin(trx, {
			invitation,
			organizationId: organization.id,
			email,
			role: 'owner',
			pendingUserId: newUserId(context),
			expiresAt,
			bootstrap: true,
		});
		return { organizationId: organization.id, token };
	});
	await state.mail.send({
		to: email,
		subject: `You're the first owner of ${name}`,
		text: `You have been made the first owner of ${name}. Open this link to create your passkey and join: ${joinLink(state.shell, invitation, token)}\nThis link expires at ${expiresAt.toISOString()}.`,
	});
	return { organizationId, invitation, expiresAt };
}
