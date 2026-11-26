/**
 * @fileoverview The test-only provider itself (phase 3 specification, 2.4): Better Auth from
 * `createLoamAuthOptions` on a `node:sqlite` database, migrated, with the organization and its people
 * seeded and the binding pinned. The host's child serves it; a unit may run it in its own process.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { IdentityMethodV1 } from '@lushly-dev/loam-manifest';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { bootstrapOrganization } from '../bootstrap.js';
import {
	createLoamAuthOptions,
	type LoamAuthConfig,
	type LoamMailV1,
	type LoamOidcProviderV1,
} from '../options.js';
import type { TestPersonV1 } from './index.js';

export interface TestProviderConfig {
	baseURL: string;
	secret: string;
	database: DatabaseSync;
	workspace: string;
	organization: { slug: string; name: string };
	people: readonly TestPersonV1[];
	methods: readonly IdentityMethodV1[];
	send(message: LoamMailV1): Promise<void>;
	/** The deployer's single sign-on providers `methods` names as `oidc:<id>`. */
	oidc?: readonly LoamOidcProviderV1[];
	/** The shell's address, `<origin><base_path>`, the links' root. Default from `baseURL`. */
	shell?: string;
	/**
	 * Whom `bootstrapOrganization` invites as the first owner (5.6); its join link is in the mail. Default an address
	 * no one reads, whose grant stays pending; the people are seeded beside it.
	 */
	bootstrapOwner?: string;
	/** The provider's rate limit, raised for a suite's many requests from one address; default 10,000 per 10 s. */
	rateLimit?: { window: number; max: number };
	/** The host's removal callback (phase 3's A4), heard once per removal. */
	onMemberRemoved?: LoamAuthConfig['onMemberRemoved'];
	/** The authorization server's options: a test's other resources and shorter token lifetime among them (P3-H1, P3-H4). */
	oauth?: LoamAuthConfig['oauth'];
}

/** What the test-only provider raises the limit to by default: suites sign in many times from one address. */
export const TEST_RATE_LIMIT = Object.freeze({ window: 10, max: 10_000 });

/** A migrated, seeded provider, and what it seeded. */
export async function createTestProvider(config: TestProviderConfig) {
	const options = {
		...createLoamAuthOptions({
			baseURL: config.baseURL,
			secret: config.secret,
			database: config.database,
			workspace: config.workspace,
			organization: config.organization.slug,
			methods: config.methods,
			mail: { send: config.send },
			...(config.oidc ? { oidc: config.oidc } : {}),
			...(config.shell ? { shell: config.shell } : {}),
			rateLimit: config.rateLimit ?? TEST_RATE_LIMIT,
			...(config.onMemberRemoved ? { onMemberRemoved: config.onMemberRemoved } : {}),
			...(config.oauth ? { oauth: config.oauth } : {}),
		}),
		logger: { disabled: true },
	};
	await (await getMigrations(options)).runMigrations();
	const auth = betterAuth(options);
	const now = new Date();
	// The organization and its binding as a deployer makes them (5.6), with the first owner's invitation.
	const organization = {
		id: (
			await bootstrapOrganization(auth, {
				slug: config.organization.slug,
				name: config.organization.name,
				ownerEmail: config.bootstrapOwner ?? `owner@${config.organization.slug}.invalid`,
			})
		).organizationId,
	};
	const people = await seedTestPeople(auth, organization.id, config.people, now);
	return { auth, organizationId: organization.id, people };
}

/**
 * The people a test names, seeded through the database adapter, past every hook, so a test starts with the
 * members it names; a test of enrolment invites and joins through the provider instead. The test-only auth host
 * and phase 6's `startDevHost` seed through it (phase 6 specification, 5.2). Each person's user id, by email.
 */
export async function seedTestPeople(
	auth: { $context: Promise<unknown> },
	organizationId: string,
	seeded: readonly TestPersonV1[],
	now = new Date()
): Promise<Record<string, string>> {
	const context = (await auth.$context) as Awaited<ReturnType<typeof betterAuth>['$context']>;
	const create = <T>(model: string, data: Record<string, unknown>) =>
		context.adapter.create({ model, data }) as Promise<T>;
	const people: Record<string, string> = {};
	for (const person of seeded) {
		const user = await create<{ id: string }>('user', {
			email: person.email,
			// A fixed placeholder, never a part of the email (I1; the final check's NIT 6).
			name: person.name ?? 'Seeded person',
			emailVerified: person.emailVerified ?? true,
			createdAt: now,
			updatedAt: now,
		});
		people[person.email] = user.id;
		if (person.password !== undefined) {
			await create('account', {
				userId: user.id,
				accountId: user.id,
				providerId: 'credential',
				password: await context.password.hash(person.password),
				createdAt: now,
				updatedAt: now,
			});
		}
		if (person.role) {
			await create('member', {
				organizationId,
				userId: user.id,
				role: person.role,
				createdAt: now,
			});
		}
	}
	return people;
}
