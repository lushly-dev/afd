import { fixedClock } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { AuthAdapterError } from '../errors.js';
import { MockAuthAdapter } from './mock.js';
import { sessionHandle } from './session-rows.js';

const ADA = 'mock-user-ada@example.test';
const BEA = 'mock-user-bea@example.test';
const START = Date.parse('2026-11-09T12:00:00Z');

function signedIn(email: string, adapter = new MockAuthAdapter()) {
	return adapter.signIn({ method: 'credentials', email }).then(() => adapter);
}

describe('MockAuthAdapter clock', () => {
	it('times sessions, passkeys and invitations on its clock', async () => {
		const clock = fixedClock(START);
		const adapter = new MockAuthAdapter({ clock, roles: { acme: { [ADA]: 'owner' } } });
		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		const state = adapter.getSession();
		if (state.status !== 'authenticated') throw new Error('Expected a session');
		expect(state.session).toEqual({
			id: `mock-session-${START}`,
			expiresAt: new Date(START + 3600_000),
		});
		clock.advance(1_000);
		expect((await adapter.passkeys.addPasskey()).createdAt).toEqual(new Date(START + 1_000));
		const invitation = await adapter.organization.invite('acme', {
			email: 'bea@example.test',
			role: 'member',
		});
		expect(invitation.expiresAt).toEqual(new Date(START + 1_000 + 48 * 3600_000));
	});

	it('refresh() ends a session past its expiry on the clock, and only then', async () => {
		const clock = fixedClock(START);
		const adapter = await signedIn('ada@example.test', new MockAuthAdapter({ clock }));
		const statuses: string[] = [];
		adapter.onAuthStateChange((state) => statuses.push(state.status));

		clock.advance(3600_000 - 1);
		await adapter.refresh();
		expect(adapter.getSession().status).toBe('authenticated');
		clock.advance(1);
		await adapter.refresh();
		expect(adapter.getSession().status).toBe('unauthenticated');
		expect(statuses).toEqual(['unauthenticated']);

		await adapter.refresh();
		expect(statuses).toEqual(['unauthenticated']);
		adapter._setUser({ id: 'u1', email: 'u1@example.test' }, { expiresAt: undefined });
		await adapter.refresh();
		expect(adapter.getSession().status).toBe('authenticated');
	});
});

describe('MockAuthAdapter passkeys', () => {
	it('adds, lists, renames and removes the signed-in person’s passkeys', async () => {
		const adapter = await signedIn('ada@example.test');
		const added = await adapter.passkeys.addPasskey({ name: 'Laptop' });
		expect(added).toMatchObject({
			id: 'mock-passkey-1',
			name: 'Laptop',
			deviceType: 'multiDevice',
		});
		await adapter.passkeys.renamePasskey(added.id, 'Work');
		expect(await adapter.passkeys.listPasskeys()).toEqual([{ ...added, name: 'Work' }]);

		await adapter.signIn({ method: 'credentials', email: 'bea@example.test' });
		expect(await adapter.passkeys.listPasskeys()).toEqual([]);
		await expect(adapter.passkeys.renamePasskey(added.id, 'Mine')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		await expect(adapter.passkeys.removePasskey(added.id)).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});

		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		await adapter.passkeys.removePasskey(added.id);
		expect(await adapter.passkeys.listPasskeys()).toEqual([]);
	});

	it('signs in the holder of the passkey added last', async () => {
		const adapter = await signedIn('ada@example.test');
		await adapter.passkeys.addPasskey();
		await adapter.signOut();

		await expect(adapter.signIn({ method: 'passkey', autoFill: true })).resolves.toEqual({
			kind: 'signed-in',
		});
		expect(adapter.getSession()).toMatchObject({
			status: 'authenticated',
			user: { id: ADA, email: 'ada@example.test' },
		});
	});

	it('cancels a ceremony with no passkey to choose', async () => {
		const adapter = new MockAuthAdapter();
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PASSKEY_CANCELLED',
		});
		expect(adapter.getSession().status).toBe('unauthenticated');
	});

	it('ends ceremonies as _setPasskeyCeremony says', async () => {
		const adapter = await signedIn('ada@example.test');
		await adapter.passkeys.addPasskey();
		await adapter.signOut();

		adapter._setPasskeyCeremony('cancel');
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toBeInstanceOf(AuthAdapterError);
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PASSKEY_CANCELLED',
			retryable: false,
		});
		adapter._setPasskeyCeremony('unsupported');
		await expect(adapter.signIn({ method: 'passkey' })).rejects.toMatchObject({
			code: 'PASSKEY_UNSUPPORTED',
			retryable: false,
		});
		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		await expect(adapter.passkeys.addPasskey()).rejects.toMatchObject({
			code: 'PASSKEY_UNSUPPORTED',
		});
		adapter._setPasskeyCeremony('complete');
		await expect(adapter.passkeys.addPasskey()).resolves.toMatchObject({ id: 'mock-passkey-2' });
	});

	it('refuses passkey management signed out', async () => {
		const adapter = new MockAuthAdapter();
		await expect(adapter.passkeys.listPasskeys()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
		await expect(adapter.passkeys.addPasskey()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
	});
});

describe('MockAuthAdapter sessions', () => {
	it('lists the one session by handle and revokes it', async () => {
		const clock = fixedClock(START);
		const adapter = await signedIn('ada@example.test', new MockAuthAdapter({ clock }));
		const handle = await sessionHandle(`mock-session-${START}`);
		expect(await adapter.sessions.listSessions()).toEqual([
			{
				handle,
				current: true,
				createdAt: new Date(START),
				updatedAt: new Date(START),
				expiresAt: new Date(START + 3600_000),
			},
		]);

		await adapter.sessions.revokeSession('others');
		expect(adapter.getSession().status).toBe('authenticated');
		await expect(adapter.sessions.revokeSession('0000000000000000')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		await adapter.sessions.revokeSession(handle);
		expect(adapter.getSession().status).toBe('unauthenticated');
		expect(await adapter.sessions.listSessions()).toEqual([]);
		await expect(adapter.sessions.revokeSession('others')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
	});

	it('revokes every session with all', async () => {
		const adapter = await signedIn('ada@example.test');
		await adapter.sessions.revokeSession('all');
		expect(adapter.getSession().status).toBe('unauthenticated');
	});
});

describe('MockAuthAdapter organization', () => {
	const roles = { acme: { [ADA]: 'owner' } };

	it('answers membership from its roles option, by organization id', async () => {
		const adapter = await signedIn('ada@example.test', new MockAuthAdapter({ roles }));
		expect(await adapter.organization.membership('acme')).toEqual({ role: 'owner' });
		expect(await adapter.organization.membership('other')).toBeNull();
		await expect(adapter.organization.membership('')).rejects.toThrow(TypeError);
		await adapter.signIn({ method: 'credentials', email: 'bea@example.test' });
		expect(await adapter.organization.membership('acme')).toBeNull();
		await expect(adapter.organization.listMembers('acme')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
	});

	it('invites, accepts, sets roles and removes, as an owner may', async () => {
		const adapter = await signedIn('ada@example.test', new MockAuthAdapter({ roles }));
		const org = adapter.organization;
		const invitation = await org.invite('acme', { email: 'bea@example.test', role: 'member' });
		expect(await org.listInvitations('acme')).toEqual([invitation]);

		await adapter.signIn({ method: 'credentials', email: 'bea@example.test' });
		expect(await org.listOwnInvitations()).toEqual([invitation]);
		await expect(
			org.invite('acme', { email: 'cy@example.test', role: 'member' })
		).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		await org.acceptInvitation(invitation.id);
		expect(await org.membership('acme')).toEqual({ role: 'member' });
		await expect(org.acceptInvitation(invitation.id)).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		// A member may not manage the organization.
		await expect(
			org.invite('acme', { email: 'cy@example.test', role: 'member' })
		).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});

		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		const members = await org.listMembers('acme');
		expect(members.map((m) => [m.userId, m.role, m.user.email])).toEqual([
			[ADA, 'owner', 'ada@example.test'],
			[BEA, 'member', 'bea@example.test'],
		]);
		expect(await org.listMembers('acme', { offset: 1, limit: 1 })).toEqual([members[1]]);
		const owner = members[0];
		const bea = members[1];
		if (!owner || !bea) throw new Error('Expected two members');

		await expect(org.setRole('acme', owner.id, 'member')).rejects.toThrow(
			/YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER/
		);
		await expect(org.removeMember('acme', owner.id)).rejects.toThrow(
			/YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER/
		);
		await expect(org.leave('acme')).rejects.toThrow(
			/YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER/
		);
		await org.setRole('acme', bea.id, 'owner');
		await org.setRole('acme', owner.id, 'owner');
		await org.removeMember('acme', bea.id);
		await expect(org.removeMember('acme', bea.id)).rejects.toThrow(/MEMBER_NOT_FOUND/);
		expect((await org.listMembers('acme')).map((m) => m.userId)).toEqual([ADA]);

		const cancelled = await org.invite('acme', { email: 'cy@example.test', role: 'member' });
		await expect(org.cancelInvitation('other', cancelled.id)).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		await org.cancelInvitation('acme', cancelled.id);
		await expect(org.cancelInvitation('acme', 'mock-invitation-404')).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect((await org.listInvitations('acme')).map((i) => i.status)).toEqual([
			'accepted',
			'canceled',
		]);
	});

	it('rejects an invitation, and refuses one past its expiry', async () => {
		const clock = fixedClock(START);
		const adapter = await signedIn('ada@example.test', new MockAuthAdapter({ clock, roles }));
		const first = await adapter.organization.invite('acme', {
			email: 'bea@example.test',
			role: 'member',
		});
		const second = await adapter.organization.invite('acme', {
			email: 'bea@example.test',
			role: 'admin',
		});
		await adapter.signIn({ method: 'credentials', email: 'bea@example.test' });
		await adapter.organization.rejectInvitation(first.id);
		clock.advance(48 * 3600_000);
		await expect(adapter.organization.acceptInvitation(second.id)).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
		});
		expect(await adapter.organization.membership('acme')).toBeNull();
	});

	it('lets a member who is not the last owner leave', async () => {
		const adapter = await signedIn(
			'bea@example.test',
			new MockAuthAdapter({ roles: { acme: { [ADA]: 'owner', [BEA]: 'member' } } })
		);
		await adapter.organization.leave('acme');
		expect(await adapter.organization.membership('acme')).toBeNull();
	});
});
