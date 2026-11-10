/**
 * @fileoverview `@lushly-dev/afd-auth/mock-capabilities`: the Mock's `sessions`, `passkeys` and
 * `organization`, attached to an existing `MockAuthAdapter` by `withMockCapabilities`. A subpath
 * of its own, so a host that only signs in with the Mock (a first paint) never bundles them.
 */

import type { MockAuthAdapter } from './adapters/mock.js';
import {
	MockDirectory,
	type MockPasskeyCeremony,
	type MockRoles,
} from './adapters/mock-directory.js';
import type { OrganizationAccess, PasskeyManagement, SessionManagement } from './types.js';

export type { MockPasskeyCeremony, MockRoles } from './adapters/mock-directory.js';

export interface MockCapabilitiesOptions {
	/**
	 * Organization members and their roles, by organization id and then user id, such as
	 * `{ 'org-1': { 'mock-user-ada@example.com': 'owner' } }`. Default: no organizations.
	 */
	roles?: MockRoles;
}

/** A `MockAuthAdapter` with its capabilities attached. */
export type MockAuthAdapterWithCapabilities = MockAuthAdapter & {
	readonly sessions: SessionManagement;
	readonly passkeys: PasskeyManagement;
	readonly organization: OrganizationAccess;
	/**
	 * How the following passkey ceremonies end until this is called again: `complete` (the
	 * default), `cancel` (`PASSKEY_CANCELLED`) or `unsupported` (`PASSKEY_UNSUPPORTED`). A passkey
	 * sign-in that completes signs in the holder of the passkey added last.
	 */
	_setPasskeyCeremony(outcome: MockPasskeyCeremony): void;
};

/**
 * Attach `sessions`, `passkeys` and `organization` to `mock`, in memory, timed on the Mock's own
 * clock, with `roles` for its organizations. Returns the same adapter. Once attached, a passkey
 * sign-in signs in the holder of the passkey added last, or is `PASSKEY_CANCELLED` with none.
 *
 * Call it once per Mock: a second call on the same Mock throws, rather than replacing records a
 * caller may already hold. A host that may reach it twice checks `mock.sessions` first.
 *
 * @throws TypeError when the capabilities are already attached
 */
export function withMockCapabilities(
	mock: MockAuthAdapter,
	options: MockCapabilitiesOptions = {}
): MockAuthAdapterWithCapabilities {
	if (mock.sessions !== undefined || mock._passkeyUser !== undefined) {
		throw new TypeError('The Mock already has its capabilities');
	}
	const directory = new MockDirectory(mock, options.roles);
	mock._passkeyUser = () => directory.passkeyUser();
	return Object.assign(mock, {
		sessions: directory.sessions,
		passkeys: directory.passkeys,
		organization: directory.organization,
		_setPasskeyCeremony(outcome: MockPasskeyCeremony) {
			directory.ceremony = outcome;
		},
	});
}
