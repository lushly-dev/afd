/**
 * E6, E7, E11, E15, E17, E18 and E19 in Chromium (phase 3 specification, 5.1 to 5.8, 7 and 18): the account section, the
 * members and owners, enrolment by invitation and recovery, through a test-only auth host. A real Better Auth 1.7.18
 * server stands behind `api/auth/` on the shell's own HTTPS origin; it proves no hosted lane (2.4). The deployer's
 * single sign-on is a test-only OpenID provider on loopback, which proves nothing of a real one. Passkeys are made by
 * Chromium's virtual authenticator, through its DevTools `WebAuthn` domain: no real authenticator or platform prompt
 * is involved, and the browser's own passkey prompt, outside the page, is not tested.
 */

import { startTestOidcProvider, type TestOidcProvider } from '@lushly-dev/loam-identity/testing';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addVirtualAuthenticator,
	axe,
	type DeploymentSite,
	focused,
	kernelCall,
	launchForDevHost,
	linkToken,
	openPage,
	openShell,
	providerDeployment,
	recordSecretsSent,
	type ShellPage,
	secretsHeld,
	secretsNow,
	serveDeployment,
	settle,
	unsearched,
} from '../harness';

const PASSWORD = 'correct horse battery staple';

let browser: Browser;
let site: DeploymentSite;
let oidc: TestOidcProvider;
const opened: ShellPage[] = [];

beforeAll(async () => {
	oidc = await startTestOidcProvider();
	site = await serveDeployment({
		config: providerDeployment(['passkey', 'password', 'oidc:corp']),
		authHost: {
			organization: { slug: 'acme', name: 'Acme' },
			methods: ['passkey', 'password', 'oidc:corp'],
			oidc: [
				{
					id: 'corp',
					clientId: oidc.clientId,
					clientSecret: oidc.clientSecret,
					discoveryUrl: oidc.discoveryUrl,
				},
			],
			people: [
				{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
				{ email: 'ada@example.com', name: 'Ada', role: 'admin', password: PASSWORD },
				{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
				{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
				{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
				{ email: 'eve@example.com', name: 'Eve', role: null, password: PASSWORD },
				// Signed in by E11's keyboard revocation alone, on two devices, so its other session is known.
				{ email: 'fay@example.com', name: 'Fay', role: 'member', password: PASSWORD },
			],
			// For the OAuth login page's single sign-on (E20).
			clients: [{ name: 'Claude Code', redirect: 'http://127.0.0.1:9/callback' }],
		},
	});
	browser = await launchForDevHost({ spki: site.spki as string });
});
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await site?.close();
	await oidc?.close();
});

const host = () => site.authHost as NonNullable<DeploymentSite['authHost']>;

/**
 * E15: no profile holds the password, a mailed link's token, a secret a page sent, nor a cookie, token or address of
 * a session now or in `earlier`, and each had a journal and a store to search.
 */
async function expectNoSecret(
	shells: ShellPage[],
	options: {
		links: string[];
		sent: ReturnType<typeof recordSecretsSent>[];
		earlier?: Awaited<ReturnType<typeof secretsNow>>[];
		/** Profiles that never signed in, which may hold no store row. */
		signedOut?: ShellPage[];
	}
): Promise<void> {
	for (const shell of shells) {
		await settle(shell.page);
		const { held, found } = await secretsHeld(shell, {
			authHost: host(),
			password: PASSWORD,
			linkTokens: options.links.map(linkToken),
			sent: {
				values: options.sent.flatMap((entry) => entry.values),
				registrations: 0,
				authentications: 0,
				codes: 0,
			},
			earlier: options.earlier ?? [],
		});
		expect(unsearched(held)).toEqual([]);
		if (!options.signedOut?.includes(shell)) expect(held.store.rows).toBeGreaterThan(0);
		expect(found).toEqual([]);
	}
}

async function open(path = ''): Promise<ShellPage> {
	const page = await openShell(browser, `${site.root}${path}`);
	opened.push(page);
	return page;
}
async function openLink(url: string): Promise<ShellPage> {
	const page = await openPage(browser, url);
	opened.push(page);
	await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
	return page;
}

const shadow = (page: Page, selector: string) => page.locator('loam-shell').locator(selector);
const link = (page: Page) => page.locator('loam-link-page');
const accountOf = (page: Page) =>
	page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account
	);
const mainHeading = (page: Page) =>
	page.evaluate(
		() =>
			document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.shadowRoot?.querySelector('h1')
				?.textContent?.trim() ?? ''
	);

async function signIn(page: Page, email: string): Promise<void> {
	const answer = (await kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean; error?: unknown };
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	await settle(page);
}

/** The last link the provider mailed to `email`. */
async function mailedLink(email: string): Promise<string> {
	let found: string | undefined;
	await expect
		.poll(async () => {
			const mail = (await host().mail()).filter((message) => message.to === email).at(-1);
			found = mail ? /https:\/\/\S+/.exec(mail.text)?.[0] : undefined;
			return found;
		})
		.toBeTruthy();
	return found as string;
}

describe('P3-E17: enrolment by invitation only, through a test-only auth host', () => {
	it('P3-E17: P3-E15: an owner invites from the members tab; the invitee creates a passkey from the mailed link with no session, and is a member; the link fails a second time', async () => {
		const owner = await open();
		await signIn(owner.page, 'olu@example.com');
		expect(
			(await kernelCall(owner.page, 'section-open', { section: 'account', path: 'members' })) as {
				success: boolean;
			}
		).toMatchObject({ success: true });
		const section = shadow(owner.page, 'loam-main loam-account-section');
		await section.locator('#invite-email').fill('newcomer@example.com');
		await section.getByRole('button', { name: 'Invite', exact: true }).click();
		await expect
			.poll(() => section.locator('.status').textContent())
			.toBe('Invited newcomer@example.com.');
		expect(new URL(owner.page.url()).pathname).toBe('/personal/~/account/members');
		const url = await mailedLink('newcomer@example.com');
		expect(new URL(url).pathname).toBe('/~/join');
		// A fresh browser, with no session: the join page, then a passkey made with user verification.
		const invitee = await openLink(url);
		const sent = recordSecretsSent(invitee.page);
		await addVirtualAuthenticator(invitee.page, { userVerified: true });
		await expect.poll(() => link(invitee.page).locator('h1').textContent()).toBe('Join Acme');
		expect(await axe(invitee.page)).toEqual([]);
		// The token leaves the address bar once read (N3).
		expect(new URL(invitee.page.url()).search).toBe('');
		// The name others will see is required (I1).
		await link(invitee.page).getByRole('button', { name: 'Create a passkey' }).click();
		await expect
			.poll(() => link(invitee.page).locator('.status').textContent())
			.toContain('Give the name other members will see');
		await link(invitee.page).locator('#link-name').fill('Newcomer Person');
		await link(invitee.page).getByRole('button', { name: 'Create a passkey' }).click();
		await expect.poll(() => link(invitee.page).locator('h1').textContent()).toBe('Welcome to Acme');
		const user = host()
			.db()
			.prepare('SELECT id, emailVerified FROM user WHERE email = ?')
			.get('newcomer@example.com') as {
			id: string;
			emailVerified: number;
		};
		expect(user.emailVerified).toBe(1);
		expect(
			host().db().prepare('SELECT count(*) AS n FROM account WHERE userId = ?').get(user.id)
		).toEqual({ n: 0 });
		expect(host().db().prepare('SELECT role FROM member WHERE userId = ?').get(user.id)).toEqual({
			role: 'member',
		});
		// Signed in by that ceremony: the shell in the same browser is the member's.
		await invitee.page.goto(site.root);
		await invitee.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => accountOf(invitee.page)).toBe('Newcomer Person');
		// E15: neither profile, the owner's that invited nor the invitee's, holds the join token, the ceremony's bytes,
		// the password, or a session's cookie, token or address.
		expect(sent.registrations).toBeGreaterThanOrEqual(1);
		await expectNoSecret([owner, invitee], { links: [url], sent: [sent] });
		// The link a second time, in yet another browser.
		const again = await openLink(url);
		await expect
			.poll(() => link(again.page).locator('h1').textContent())
			.toBe('This link does not work');
		expect(invitee.errors).toEqual([]);
		// The refused check is a 404, which the browser logs as a failed resource; nothing else.
		expect(again.errors.filter((error) => !/status of 404/.test(error))).toEqual([]);
		expect([...invitee.violations, ...again.violations]).toEqual([]);
	});

	it('P3-E17: a join link with a session present says "Sign out first"; one for an existing account says to sign in and accept', async () => {
		const owner = await open();
		await signIn(owner.page, 'olu@example.com');
		await kernelCall(owner.page, 'member-invite', { email: 'second@example.com', role: 'member' });
		await kernelCall(owner.page, 'member-invite', { email: 'eve@example.com', role: 'member' });
		const fresh = await mailedLink('second@example.com');
		// The owner's own browser holds a session.
		await owner.page.goto(fresh);
		await owner.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		await expect.poll(() => link(owner.page).locator('h1').textContent()).toBe('Sign out first');
		const existing = await openLink(await mailedLink('eve@example.com'));
		await expect
			.poll(() => link(existing.page).locator('h1').textContent())
			.toBe('You already have an account');
	});
});

describe('P3-E7: membership, the binding, and invitations', () => {
	it('P3-E7: a signed-in member of another organization sees the notice and their invitation, accepts it with a verified email, and enters', async () => {
		// Dee belongs to another organization at the same provider, and not to the bound one.
		const now = new Date().toISOString();
		const db = host().db({ writable: true });
		db.prepare(
			"INSERT INTO organization (id, name, slug, createdAt) VALUES ('org-globex', 'Globex', 'globex', ?)"
		).run(now);
		db.prepare(
			"INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('m-dee-globex', 'org-globex', ?, 'owner', ?)"
		).run(host().people['dee@example.com'] as string, now);
		const owner = await open();
		await signIn(owner.page, 'olu@example.com');
		const invited = (await kernelCall(owner.page, 'member-invite', {
			email: 'dee@example.com',
			role: 'member',
		})) as {
			success: boolean;
			error?: unknown;
		};
		expect(invited.success, JSON.stringify(invited.error)).toBe(true);
		const dee = await open();
		await signIn(dee.page, 'dee@example.com');
		await expect.poll(() => mainHeading(dee.page)).toBe('You are not a member of acme');
		await shadow(dee.page, 'loam-main .sign-in').click();
		const panel = shadow(dee.page, 'loam-main loam-account-invitations');
		await panel.getByRole('button', { name: 'Accept the invitation to Acme' }).click();
		await expect.poll(() => mainHeading(dee.page)).not.toBe('You are not a member of acme');
		// A member of both now: the other organization's membership granted nothing here, the invitation did.
		const memberships = host()
			.db()
			.prepare('SELECT organizationId FROM member WHERE userId = ?')
			.all(host().people['dee@example.com'] as string) as { organizationId: string }[];
		expect(memberships.map((row) => row.organizationId).sort()).toEqual(
			[host().organizationId, 'org-globex'].sort()
		);
		// The other organization goes, so no later test meets it.
		db.prepare("DELETE FROM member WHERE organizationId = 'org-globex'").run();
		db.prepare("DELETE FROM organization WHERE id = 'org-globex'").run();
		const listed = (await kernelCall(dee.page, 'project-list')) as { success: boolean };
		expect(listed.success).toBe(true);
		const order = (
			(await dee.page.evaluate(async () =>
				(
					document.querySelector('loam-shell') as unknown as {
						journal: { read(): Promise<{ command: string }[]> };
					}
				).journal.read()
			)) as { command: string }[]
		).map((entry) => entry.command);
		expect(order.lastIndexOf('account-invitation-accept')).toBeLessThan(
			order.lastIndexOf('session-settle')
		);
		expect(dee.errors).toEqual([]);
	});
});

describe('P3-E6: owners in Chromium', () => {
	it('P3-E6: the members tab shows owner controls to an owner only, absent for a member, whose owner command is OWNER_REQUIRED', async () => {
		const bea = await open();
		await signIn(bea.page, 'bea@example.com');
		await kernelCall(bea.page, 'section-open', { section: 'account', path: 'members' });
		const section = shadow(bea.page, 'loam-main loam-account-section');
		await expect.poll(() => section.locator('tbody tr').count()).toBeGreaterThan(2);
		expect(await section.locator('#invite-email').count()).toBe(0);
		expect(await section.getByRole('button', { name: /^Remove / }).count()).toBe(0);
		expect(await section.locator('td').allTextContents()).not.toContain('olu@example.com');
		const refused = (await kernelCall(bea.page, 'member-invite', {
			email: 'x@example.com',
			role: 'member',
		})) as {
			error?: { code: string };
		};
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		const app = (await kernelCall(bea.page, 'workspace-app-set', {
			instance: 'none',
			title: 'x',
		})) as {
			error?: { code: string };
		};
		expect(app.error?.code).toBe('OWNER_REQUIRED');
		expect(await axe(bea.page)).toEqual([]);
		const ada = await open();
		await signIn(ada.page, 'ada@example.com');
		await kernelCall(ada.page, 'section-open', { section: 'account', path: 'members' });
		const owned = shadow(ada.page, 'loam-main loam-account-section');
		await owned.locator('#invite-email').waitFor();
		await expect.poll(() => owned.getByRole('button', { name: 'Remove Bea' }).count()).toBe(1);
		// An admin is an owner, but never offers the owner role in an invitation (7.1).
		expect(await owned.locator('#invite-role option').allTextContents()).toEqual([
			'Member',
			'Admin',
		]);
		expect(await axe(ada.page)).toEqual([]);
	});
});

describe('P3-E18: recovery, through a test-only auth host', () => {
	it('P3-E18: P3-E15: "Can\'t sign in?" mails a link; it restores access with a new passkey, signs out every other session, and the account shows the notice', async () => {
		const other = await open();
		await signIn(other.page, 'cy@example.com');
		// E15: read now, since the recovery deletes that session.
		const before = await secretsNow(other, host());
		expect(before.cookies.length).toBeGreaterThan(0);
		const page = await open();
		await shadow(page.page, 'loam-main .sign-in').click();
		const dialog = shadow(page.page, 'loam-sign-in-dialog');
		await dialog.getByRole('button', { name: "Can't sign in?", exact: true }).click();
		await dialog.locator('#recover-email').fill('cy@example.com');
		await dialog.getByRole('button', { name: 'Email me a link' }).click();
		// The provider answers 1,000 ms after the request, whatever it found (5.7).
		await expect
			.poll(() => dialog.locator('.message').textContent(), { timeout: 5_000 })
			.toContain('If cy@example.com has an account, a link to restore your access is on its way');
		const url = await mailedLink('cy@example.com');
		const recovering = await openLink(url);
		const sent = recordSecretsSent(recovering.page);
		await addVirtualAuthenticator(recovering.page, { userVerified: true });
		await expect
			.poll(() => link(recovering.page).locator('h1').textContent())
			.toBe('Restore your access');
		expect(await axe(recovering.page)).toEqual([]);
		await link(recovering.page).getByRole('button', { name: 'Create a passkey' }).click();
		await expect
			.poll(() => link(recovering.page).locator('h1').textContent())
			.toBe('Your access is restored');
		// Every other session is gone at the provider; the other page shows it at its next read.
		const cy = host().people['cy@example.com'] as string;
		expect(
			host().db().prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(cy)
		).toEqual({ n: 1 });
		await other.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect.poll(() => accountOf(other.page), { timeout: 5_000 }).toBe('');
		const announced = (await host().mail())
			.filter((message) => message.to === 'cy@example.com')
			.at(-1);
		expect(announced?.text).toContain("If this wasn't you, contact an owner");
		// The account section says so at the next sign-in.
		await recovering.page.goto(`${site.root}personal/~/account`);
		await recovering.page.waitForFunction(
			() => document.documentElement.dataset.loamHost === 'web'
		);
		const section = shadow(recovering.page, 'loam-main loam-account-section');
		await expect
			.poll(() => section.locator('[role="note"]').first().textContent())
			.toContain('Your access was restored on');
		// E15: no profile, the one that asked, the one that restored nor the one whose session it ended, holds the
		// recovery token, the ceremony's bytes, the password, or a session's cookie, token or address.
		expect(sent.registrations).toBeGreaterThanOrEqual(1);
		await expectNoSecret([page, recovering, other], {
			links: [url],
			sent: [sent],
			earlier: [before],
			signedOut: [page],
		});
		// The link a second time.
		const again = await openLink(url);
		await expect
			.poll(() => link(again.page).locator('h1').textContent())
			.toBe('This link does not work');
	});

	it('P3-E18: P3-E15: single sign-on recovery runs the ceremony and lets its session register a passkey for a holder', async () => {
		// Bea links the deployer's single sign-on and holds a passkey.
		oidc.as({ sub: 'sub-bea', email: 'bea@example.com' });
		const linked = await open();
		const linkedSent = recordSecretsSent(linked.page);
		await shadow(linked.page, 'loam-main .sign-in').click();
		await shadow(linked.page, 'loam-sign-in-dialog')
			.getByRole('button', { name: 'Continue with corp' })
			.click();
		await linked.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => accountOf(linked.page), { timeout: 10_000 }).toBe('Bea');
		// E15: read now, since the recovery ends that session.
		const before = await secretsNow(linked, host());
		const bea = host().people['bea@example.com'] as string;
		expect(
			host()
				.db()
				.prepare("SELECT count(*) AS n FROM account WHERE userId = ? AND providerId = 'corp'")
				.get(bea)
		).toEqual({ n: 1 });
		host()
			.db({ writable: true })
			.prepare(
				"INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt) VALUES ('pk-bea', 'Old', 'x', ?, 'cred-bea', 0, 'singleDevice', 0, '', ?)"
			)
			.run(bea, new Date().toISOString());
		// "Can't sign in? Use corp": the ceremony, then a new passkey from its session.
		const page = await open();
		const sent = recordSecretsSent(page.page);
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog')
			.getByRole('button', { name: "Can't sign in? Use corp" })
			.click();
		await page.page.waitForFunction(
			() => document.documentElement.dataset.loamHost === 'link',
			undefined,
			{ timeout: 10_000 }
		);
		await addVirtualAuthenticator(page.page, { userVerified: true });
		await expect
			.poll(() => link(page.page).locator('h1').textContent())
			.toBe('Create a new passkey');
		await link(page.page).getByRole('button', { name: 'Create a passkey' }).click();
		await expect
			.poll(() => link(page.page).locator('h1').textContent())
			.toBe('Your access is restored');
		expect(
			host().db().prepare('SELECT count(*) AS n FROM passkey WHERE userId = ?').get(bea)
		).toEqual({ n: 2 });
		expect(
			host().db().prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(bea)
		).toEqual({ n: 1 });
		// E15: neither profile holds the sign-on's code, the ceremony's bytes, or a session's cookie, token or address,
		// the ended one's included, once the restored one has opened the shell.
		expect(sent.registrations).toBeGreaterThanOrEqual(1);
		expect(sent.codes).toBeGreaterThanOrEqual(1);
		await page.page.goto(site.root);
		await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => accountOf(page.page)).toBe('Bea');
		expect(linkedSent.codes).toBeGreaterThanOrEqual(1);
		// The account section says the access was restored, as after a recovery by email.
		await kernelCall(page.page, 'section-open', { section: 'account' });
		await expect
			.poll(() =>
				shadow(page.page, 'loam-main loam-account-section')
					.locator('[role="note"]')
					.first()
					.textContent()
			)
			.toContain('Your access was restored on');
		await expectNoSecret([page, linked], {
			links: [],
			sent: [sent, linkedSent],
			earlier: [before],
		});
	});
});

describe('P3-E19: a re-created organization grants nothing, through a test-only auth host', () => {
	it('P3-E19: a new organization with the bound slug, and its members, are not members of the workspace; an owner sees the mismatch', async () => {
		const db = host().db({ writable: true });
		const now = new Date().toISOString();
		db.prepare("UPDATE organization SET slug = 'acme-old' WHERE id = ?").run(host().organizationId);
		db.prepare(
			"INSERT INTO organization (id, name, slug, createdAt) VALUES ('org-new', 'Acme', 'acme', ?)"
		).run(now);
		db.prepare(
			"INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('m-eve', 'org-new', ?, 'owner', ?)"
		).run(host().people['eve@example.com'] as string, now);
		try {
			const eve = await open();
			await signIn(eve.page, 'eve@example.com');
			await expect.poll(() => mainHeading(eve.page)).toBe('You are not a member of acme');
			const olu = await open();
			await signIn(olu.page, 'olu@example.com');
			await expect
				.poll(() =>
					olu.page.evaluate(
						() => (document.querySelector('loam-shell') as unknown as { notice: string }).notice
					)
				)
				.toContain('IDENTITY_BINDING_MISMATCH');
		} finally {
			db.prepare("DELETE FROM member WHERE id = 'm-eve'").run();
			db.prepare("DELETE FROM organization WHERE id = 'org-new'").run();
			db.prepare("UPDATE organization SET slug = 'acme' WHERE id = ?").run(host().organizationId);
		}
	});
});

/** Press Tab until focus is on the element `matches` names, as a keyboard user would reach it; fails past `max`. */
async function tabTo(
	page: Page,
	matches: (at: Awaited<ReturnType<typeof focused>> & { id: string }) => boolean,
	what: string,
	max = 40
): Promise<void> {
	for (let pressed = 0; pressed < max; pressed++) {
		await page.keyboard.press('Tab');
		const id = await page.evaluate(() => {
			let element: Element | null = document.activeElement;
			while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
			return element?.id ?? '';
		});
		if (matches({ ...(await focused(page)), id })) return;
	}
	throw new Error(`${what} was not reached in ${max} presses of Tab`);
}
const named = (label: string) => (at: { label: string }) => at.label === label;

describe('P3-E11: the account section by keyboard and under axe', () => {
	it('P3-E11: signs in by keyboard: the dialog from main, the email and password typed, Enter', async () => {
		const page = await open();
		await tabTo(page.page, named('Sign in'), 'Main\'s "Sign in"');
		await page.page.keyboard.press('Enter');
		await shadow(page.page, 'loam-sign-in-dialog dialog[open]').waitFor();
		expect((await focused(page.page)).label).toBe('Sign in with a passkey');
		await tabTo(
			page.page,
			(at) => at.tag === 'input' && at.hosts.includes('loam-sign-in-dialog'),
			'The email field'
		);
		await page.page.keyboard.type('ada@example.com');
		await page.page.keyboard.press('Tab');
		expect((await focused(page.page)).tag).toBe('input');
		await page.page.keyboard.type(PASSWORD);
		await page.page.keyboard.press('Enter');
		await expect.poll(() => accountOf(page.page)).toBe('Ada');
	});

	it('P3-E11: adds a passkey and signs another device out by keyboard, confirming in the modal', async () => {
		const elsewhere = await open();
		await signIn(elsewhere.page, 'fay@example.com');
		const page = await open();
		await addVirtualAuthenticator(page.page, { userVerified: true });
		await signIn(page.page, 'fay@example.com');
		await kernelCall(page.page, 'section-open', { section: 'account' });
		const section = shadow(page.page, 'loam-main loam-account-section');
		// The tabs, not the heading: they fill in once the section's app list answers.
		await expect.poll(() => section.getByRole('tab').count()).toBe(6);
		await tabTo(page.page, named('Passkeys'), 'The Passkeys tab');
		await page.page.keyboard.press('Enter');
		await expect.poll(() => new URL(page.page.url()).pathname).toBe('/personal/~/account/passkeys');
		// The panel's own content, before Tab looks for it.
		await expect
			.poll(() => section.locator('[role="tabpanel"]').textContent())
			.toContain('Add a passkey');
		await tabTo(page.page, named('Add a passkey'), '"Add a passkey"');
		await page.page.keyboard.press('Enter');
		await expect
			.poll(() => section.locator('.status').textContent())
			.toBe('Your passkey is added.');
		await tabTo(page.page, named('Sessions'), 'The Sessions tab');
		await page.page.keyboard.press('Enter');
		await expect.poll(() => section.locator('td').allTextContents()).toContain('This device');
		await tabTo(
			page.page,
			(at) =>
				at.tag === 'button' && /^Sign out /.test(at.label) && at.label !== 'Sign out this device',
			"The other device's sign-out"
		);
		// The status line's every text, from here on: the fresh sign-in's prompt shows only until the revocation's answer.
		await page.page.evaluate(() => {
			// The section, wherever the shell's shadow trees hold it.
			const find = (root: Document | ShadowRoot): Element | null => {
				const here = root.querySelector('loam-account-section');
				if (here) return here;
				for (const node of root.querySelectorAll('*'))
					if (node.shadowRoot) {
						const found = find(node.shadowRoot);
						if (found) return found;
					}
				return null;
			};
			const status = find(document)?.shadowRoot?.querySelector('.status') as HTMLElement;
			const said: string[] = [];
			(globalThis as { said?: string[] }).said = said;
			new MutationObserver(() => said.push(status.textContent ?? '')).observe(status, {
				childList: true,
				characterData: true,
				subtree: true,
			});
		});
		await page.page.keyboard.press('Enter');
		// The modal says the consequence in words, with focus on Cancel; Tab reaches the confirmation.
		await expect.poll(async () => (await focused(page.page)).label).toBe('Cancel');
		expect(await section.locator('dialog[open]').textContent()).toContain(
			'That device is signed out at once; it shows "Sign in" when it next checks.'
		);
		// The destructive action's modal is under axe too (14).
		expect(await axe(page.page)).toEqual([]);
		await tabTo(page.page, named('Sign out'), 'The confirmation');
		await page.page.keyboard.press('Enter');
		await expect.poll(() => section.locator('.status').textContent()).toMatch(/^Signed out /);
		// `REAUTH_REQUIRED`'s prompt said why before the passkey ceremony (5.2, 14).
		expect(await page.page.evaluate(() => (globalThis as { said?: string[] }).said)).toContain(
			'This needs a fresh sign-in with a passkey. Confirm with your passkey to continue.'
		);
		// The other device, and only it, lost its session at the provider.
		const knows = (shell: ShellPage) =>
			shell.page.evaluate(async (url) => {
				const response = await fetch(url, { credentials: 'same-origin' });
				return (await response.json().catch(() => null)) !== null;
			}, `${site.root}api/auth/loam/whoami`);
		expect(await knows(elsewhere)).toBe(false);
		expect(await knows(page)).toBe(true);
		// Fay holds a passkey now, so her password session's first revocation is refused for freshness (5.8, a 401 the
		// browser logs) and the section signs in with the passkey and asks again: nothing else.
		expect(page.errors.filter((error) => !/status of 401/.test(error))).toEqual([]);
	});

	it('P3-E11: enrols from a join link by keyboard: the name typed, "Create a passkey" by Enter', async () => {
		const owner = await open();
		await signIn(owner.page, 'olu@example.com');
		await kernelCall(owner.page, 'member-invite', {
			email: 'keyboard@example.com',
			role: 'member',
		});
		const invitee = await openLink(await mailedLink('keyboard@example.com'));
		await addVirtualAuthenticator(invitee.page, { userVerified: true });
		await expect.poll(() => link(invitee.page).locator('h1').textContent()).toBe('Join Acme');
		const name = link(invitee.page).locator('#link-name');
		await name.waitFor();
		await tabTo(invitee.page, (at) => at.id === 'link-name', 'The name field');
		await invitee.page.keyboard.type('Keyboard Person');
		await expect.poll(() => name.inputValue()).toBe('Keyboard Person');
		await tabTo(invitee.page, named('Create a passkey'), '"Create a passkey"');
		await invitee.page.keyboard.press('Enter');
		await expect.poll(() => link(invitee.page).locator('h1').textContent()).toBe('Welcome to Acme');
	});

	it('P3-E11: the account menu opens the account section, whose tabs are links and whose passkey add is reached by keyboard', async () => {
		const page = await open();
		await addVirtualAuthenticator(page.page, { userVerified: true });
		await signIn(page.page, 'olu@example.com');
		await shadow(page.page, 'loam-titlebar .account').click();
		await shadow(page.page, 'loam-account-menu').getByRole('menuitem', { name: 'Account' }).click();
		const section = shadow(page.page, 'loam-main loam-account-section');
		// The heading is there when the section is built; its tabs only once `show()`'s app list answers: wait for them.
		await expect
			.poll(() => section.getByRole('tab').allTextContents())
			.toEqual([
				'Profile',
				'Passkeys',
				'Sessions',
				// #2783's personas tab (5.1).
				'Personas',
				'Members',
				// Step 7's connected agents (5.3).
				'Agents',
			]);
		expect(await axe(page.page)).toEqual([]);
		await section.getByRole('tab', { name: 'Passkeys' }).click();
		await expect.poll(() => new URL(page.page.url()).pathname).toBe('/personal/~/account/passkeys');
		const add = section.getByRole('button', { name: 'Add a passkey' });
		await add.focus();
		await page.page.keyboard.press('Enter');
		await expect
			.poll(() => section.locator('.status').textContent())
			.toBe('Your passkey is added.');
		// The section announces the add, then reads the list again: the row arrives after the status (#1268).
		await expect.poll(() => section.locator('tbody tr').count()).toBeGreaterThan(0);
		expect(await axe(page.page)).toEqual([]);
		await section.getByRole('tab', { name: 'Sessions' }).click();
		await expect.poll(() => section.locator('td').allTextContents()).toContain('This device');
		expect(await axe(page.page)).toEqual([]);
		expect(page.errors).toEqual([]);
		expect(page.violations).toEqual([]);
	});
});

describe("P3-E20: the OAuth login page's single sign-on (9.4, D99), through a test-only auth host", () => {
	it('P3-E20: "Sign in with corp" signs in through the deployer\'s single sign-on and resumes the authorization at the consent page', async () => {
		oidc.as({ sub: 'sub-ada', email: 'ada@example.com' });
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		opened.push({ context } as ShellPage);
		const page = await context.newPage();
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: host().clients['Claude Code'] as string,
			redirect_uri: 'http://127.0.0.1:9/callback',
			scope: 'loam:read',
			state: 'sso',
			code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
			code_challenge_method: 'S256',
			resource: `${site.root}mcp`,
		});
		const login = page.waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith('/~/oauth/login')
		);
		await page.goto(`${site.root}api/auth/oauth2/authorize?${query}`);
		await login;
		const ada = host().people['ada@example.com'] as string;
		const linked = () =>
			host()
				.db()
				.prepare("SELECT count(*) AS n FROM account WHERE userId = ? AND providerId = 'corp'")
				.get(ada);
		// Not linked before: the sign-on below links Ada's account, by her verified email.
		expect(linked()).toEqual({ n: 0 });
		const oauthPage = page.locator('loam-oauth-page');
		await oauthPage.getByRole('button', { name: 'Sign in with corp' }).click();
		await page.waitForFunction(
			() =>
				(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').includes(
					'Connect Claude Code to Acme?'
				),
			undefined,
			{ timeout: 15_000 }
		);
		expect(new URL(page.url()).pathname).toMatch(/\/~\/oauth\/consent$/);
		expect(linked()).toEqual({ n: 1 });
	});
});
