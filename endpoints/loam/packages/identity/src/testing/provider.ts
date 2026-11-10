/**
 * @fileoverview The test-only provider itself (phase 3 specification, 2.4): Better Auth from
 * `createLoamAuthOptions` on a `node:sqlite` database, migrated, with the organization and its people
 * seeded and the binding pinned. The host's child serves it; a unit may run it in its own process.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { IdentityMethodV1 } from '@lushly-dev/loam-manifest';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { bindOrganization } from '../binding.js';
import { createLoamAuthOptions, type LoamMailV1 } from '../options.js';
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
}

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
		}),
		logger: { disabled: true },
	};
	await (await getMigrations(options)).runMigrations();
	const auth = betterAuth(options);
	const context = await auth.$context;
	const now = new Date();
	// Seeded through the database adapter, past every hook, as a deployer's setup would be: step 4's
	// `bootstrapOrganization` and invitations replace it.
	const create = <T>(model: string, data: Record<string, unknown>) =>
		context.adapter.create({ model, data }) as Promise<T>;
	const organization = await create<{ id: string }>('organization', {
		name: config.organization.name,
		slug: config.organization.slug,
		createdAt: now,
	});
	const people: Record<string, string> = {};
	for (const person of config.people) {
		const user = await create<{ id: string }>('user', {
			email: person.email,
			name: person.name ?? person.email.split('@')[0],
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
				organizationId: organization.id,
				userId: user.id,
				role: person.role,
				createdAt: now,
			});
		}
	}
	await bindOrganization(context.adapter as never, {
		workspace: config.workspace,
		organization: config.organization.slug,
	});
	return { auth, organizationId: organization.id, people };
}
