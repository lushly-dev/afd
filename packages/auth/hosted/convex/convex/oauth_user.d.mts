import type { convexAuth } from '@convex-dev/auth/server';

type AuthCallbacks = NonNullable<Parameters<typeof convexAuth>[0]['callbacks']>;
export const createOrUpdateFixtureUser: NonNullable<AuthCallbacks['createOrUpdateUser']>;
