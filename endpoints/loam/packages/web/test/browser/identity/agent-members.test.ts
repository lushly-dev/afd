/**
 * P3-E5 in Chromium (phase 3 specification, 8 and 18): an agent member installed by an owner appears with its sponsor
 * and cannot sign in, through a test-only auth host. A real Better Auth 1.7.18 server stands behind `api/auth/` on the
 * shell's own HTTPS origin; it proves no hosted lane (2.4). Agent members are records of the browser's workspace store
 * until the collaboration service (D46), so the owner and the sponsor take turns in one page, as people sharing a
 * browser profile do (4.5).
 */

import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	axe,
	type DeploymentSite,
	kernelCall,
	launchForDevHost,
	openShell,
	providerDeployment,
	type ShellPage,
	serveDeployment,
	settle,
} from '../harness';

const PASSWORD = 'correct horse battery staple';

let browser: Browser;
let site: DeploymentSite;
const opened: ShellPage[] = [];

beforeAll(async () => {
	site = await serveDeployment({
		config: providerDeployment(['passkey', 'password']),
		authHost: {
			organization: { slug: 'acme', name: 'Acme' },
			methods: ['passkey', 'password'],
			people: [
				{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
				{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			],
		},
	});
	browser = await launchForDevHost({ spki: site.spki as string });
});
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await site?.close();
});

const host = () => site.authHost as NonNullable<DeploymentSite['authHost']>;
const section = (page: Page) =>
	page.locator('loam-shell').locator('loam-main loam-account-section');

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

async function membersTab(page: Page): Promise<void> {
	expect(
		(await kernelCall(page, 'section-open', { section: 'account', path: 'members' })) as {
			success: boolean;
		}
	).toMatchObject({ success: true });
	await expect.poll(() => section(page).locator('table').count()).toBeGreaterThan(0);
}

describe('P3-E5: an agent member installed by an owner appears with its sponsor and cannot sign in, through a test-only auth host', () => {
	it('P3-E5: an owner adds one with Bea as sponsor: pending, "Agent · Sponsored by Bea", confirmed by Bea, then withdrawn by her; the provider holds no account for it', async () => {
		const shell = await openShell(browser, site.root);
		opened.push(shell);
		const { page } = shell;
		await signIn(page, 'olu@example.com');
		await membersTab(page);
		const members = section(page);
		await members.locator('#agent-name').fill('Reviewer');
		await members.locator('#agent-sponsor').selectOption({ label: 'Bea' });
		await members.getByRole('button', { name: 'Add agent', exact: true }).click();
		await expect
			.poll(() => members.locator('.status').textContent())
			.toBe('Added Reviewer, waiting for Bea to confirm.');
		const row = members.getByRole('row', { name: /Reviewer/ });
		await expect.poll(() => row.textContent()).toContain('Agent · Sponsored by Bea');
		expect(await row.textContent()).toContain('Pending: waiting for Bea to confirm');
		expect(await row.textContent()).toContain('Installed');
		// The owner is not its sponsor: no confirm; the remove control is the owner's.
		expect(await row.getByRole('button', { name: 'Confirm Reviewer' }).count()).toBe(0);
		expect(await row.getByRole('button', { name: 'Remove Reviewer' }).count()).toBe(1);
		expect(await axe(page)).toEqual([]);

		// No account at the provider: no user row for it, by its id or its name (8.1).
		const listed = (await kernelCall(page, 'agent-member-list')) as {
			data: { agents: { id: string; status: string }[] };
		};
		const id = listed.data.agents[0]?.id as string;
		expect(id).toMatch(/^agt_[a-z0-9]{20}$/);
		const users = host().db().prepare('SELECT id, name, email FROM user').all() as {
			id: string;
			name: string;
			email: string;
		}[];
		expect(users.filter((user) => user.id === id || user.name === 'Reviewer')).toEqual([]);
		expect(users.some((user) => user.id.startsWith('agt_'))).toBe(false);

		// The owner's own agent never adds or removes one (3.4).
		expect(
			(
				(await agentCall(page, 'agent-member-add', { name: 'Other', sponsor: 'x' })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('HUMAN_REQUIRED');

		// Bea, in the same browser profile: no owner controls; her own agent may not confirm; she confirms.
		await kernelCall(page, 'auth-sign-out');
		await signIn(page, 'bea@example.com');
		const refused = (await kernelCall(page, 'agent-member-add', {
			name: 'Mine',
			sponsor: 'x',
		})) as { error?: { code: string } };
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		expect(
			(
				(await agentCall(page, 'agent-member-confirm', { agent: id })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('HUMAN_REQUIRED');
		await membersTab(page);
		const beaRow = section(page).getByRole('row', { name: /Reviewer/ });
		// Rendered for Bea: her confirm shows, and an owner's controls are absent, not disabled (14).
		await expect
			.poll(() => beaRow.getByRole('button', { name: 'Confirm Reviewer' }).count())
			.toBe(1);
		expect(await beaRow.textContent()).toContain('Agent · Sponsored by Bea');
		expect(await section(page).getByRole('button', { name: 'Remove Reviewer' }).count()).toBe(0);
		expect(await section(page).getByRole('form', { name: 'Add an agent member' }).count()).toBe(0);
		await beaRow.getByRole('button', { name: 'Confirm Reviewer' }).click();
		const dialog = section(page).getByRole('dialog', { name: 'Sponsor Reviewer?' });
		await expect.poll(() => dialog.count()).toBe(1);
		expect(await axe(page)).toEqual([]);
		await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect
			.poll(() => section(page).locator('.status').textContent())
			.toBe('Reviewer is active.');
		await expect
			.poll(
				async () =>
					(await section(page)
						.getByRole('row', { name: /Reviewer/ })
						.textContent()) ?? ''
			)
			.toContain('Active');
		const after = (await kernelCall(page, 'agent-member-get', { agent: id })) as {
			data: { status: string; sponsorName: string };
		};
		expect(after.data).toMatchObject({ status: 'active', sponsorName: 'Bea' });
		// Its calls journal its sponsor beside it; it cannot sign in: still no user row.
		expect(
			(host().db().prepare('SELECT count(*) AS n FROM user WHERE id = ?').get(id) as { n: number })
				.n
		).toBe(0);

		// #2781: the owner, who is not its sponsor, has no withdraw control on the active row.
		await kernelCall(page, 'auth-sign-out');
		await signIn(page, 'olu@example.com');
		await membersTab(page);
		const ownerActive = section(page).getByRole('row', { name: /Reviewer/ });
		await expect.poll(async () => (await ownerActive.textContent()) ?? '').toContain('Active');
		expect(await ownerActive.getByRole('button', { name: 'Remove Reviewer' }).count()).toBe(1);
		expect(await ownerActive.getByRole('button', { name: 'Withdraw Reviewer' }).count()).toBe(0);
		await kernelCall(page, 'auth-sign-out');
		await signIn(page, 'bea@example.com');
		await membersTab(page);

		// Bea withdraws it from its row, in a native modal that says what follows; her agent may not.
		expect(
			(
				(await agentCall(page, 'agent-member-withdraw', { agent: id })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('HUMAN_REQUIRED');
		const active = section(page).getByRole('row', { name: /Reviewer/ });
		await expect
			.poll(() => active.getByRole('button', { name: 'Withdraw Reviewer' }).count())
			.toBe(1);
		await active.getByRole('button', { name: 'Withdraw Reviewer' }).click();
		const withdraw = section(page).getByRole('dialog', { name: 'Withdraw Reviewer?' });
		await expect.poll(() => withdraw.count()).toBe(1);
		expect(await withdraw.textContent()).toContain('can do nothing more in your name');
		expect(await axe(page)).toEqual([]);
		await withdraw.getByRole('button', { name: 'Withdraw', exact: true }).click();
		await expect
			.poll(() => section(page).locator('.status').textContent())
			.toBe('You withdrew Reviewer.');
		const withdrawnRow = section(page).getByRole('row', { name: /Reviewer/ });
		await expect
			.poll(async () => (await withdrawnRow.textContent()) ?? '')
			.toContain('Suspended: its sponsor withdrew it');
		expect(await withdrawnRow.getByRole('button', { name: 'Withdraw Reviewer' }).count()).toBe(0);
		const withdrawn = (await kernelCall(page, 'agent-member-get', { agent: id })) as {
			data: { status: string; suspended: string };
		};
		expect(withdrawn.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-withdrew' });

		// The owner, who is not its sponsor, has no withdraw control.
		await kernelCall(page, 'auth-sign-out');
		await signIn(page, 'olu@example.com');
		await membersTab(page);
		const ownerRow = section(page).getByRole('row', { name: /Reviewer/ });
		await expect.poll(async () => (await ownerRow.textContent()) ?? '').toContain('Suspended');
		expect(await ownerRow.getByRole('button', { name: 'Withdraw Reviewer' }).count()).toBe(0);
		expect(await ownerRow.getByRole('button', { name: 'Remove Reviewer' }).count()).toBe(1);
	});
});
