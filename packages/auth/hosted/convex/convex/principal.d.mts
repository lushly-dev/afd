import type { DocumentByName, GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import type { GenericId } from 'convex/values';
import type { AuthIdentityConfig, PrincipalKind } from './identity.js';
import type { DataModel } from './schema.js';

type Reader = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
type UserProfile = { id: string; email: string; name?: string; image?: string };
type CurrentPrincipal =
	| { kind: 'unauthenticated' }
	| { kind: 'forbidden' }
	| {
			kind: 'authenticated';
			principalKind: PrincipalKind;
			userId: GenericId<'users'>;
			user: DocumentByName<DataModel, 'users'> | null;
			accounts: Array<{ provider: string; providerAccountId: string; emailVerified?: string }>;
			identity: AuthIdentityConfig;
	  };

export function resolveCurrentPrincipal(
	ctx: Reader,
	configuredIdentity?: AuthIdentityConfig
): Promise<CurrentPrincipal>;
export function currentUserProfile(
	ctx: Reader,
	configuredIdentity?: AuthIdentityConfig
): Promise<UserProfile | null>;
