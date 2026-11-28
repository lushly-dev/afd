/**
 * P3-E20 in Chromium (phase 3 specification, 9.4 and 18): the OAuth login and consent pages, through a test-only auth
 * host. A real Better Auth 1.7.18 server stands behind `api/auth/` on the shell's own HTTPS origin, with one client the
 * deployer pre-registered; it proves no hosted lane (2.4). The client's own redirect is never served: the test watches
 * the navigation to it.
 */

import type { Browser, Page, Response } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	focused,
	kernelCall,
	launchForDevHost,
	openShell,
	providerDeployment,
	type ShellPage,
	serveDeployment,
} from '../harness';

const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'http://127.0.0.1:9/callback';

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
				// Who has not connected the client yet, so the provider asks for consent again.
				{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
				// Who connects the client by keyboard (E11), apart from Cy, who must not have consented.
				{ email: 'dee@example.com', name: 'Dee', role: 'member', password: PASSWORD },
			],
			clients: [{ name: 'Claude Code', redirect: REDIRECT }],
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

/** An MCP client's authorization request, PKCE S256 and the resource. */
const authorize = (scope = 'loam:read loam:write', extra: Record<string, string> = {}) =>
	`${site.root}api/auth/oauth2/authorize?${new URLSearchParams({
		response_type: 'code',
		client_id: host().clients['Claude Code'] as string,
		redirect_uri: REDIRECT,
		scope,
		state: 'e20',
		code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		code_challenge_method: 'S256',
		resource: `${site.root}mcp`,
		...extra,
	})}`;

/** The page's text, through its shadow root. */
const pageText = (page: Page) =>
	page.evaluate(() =>
		(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
	);

/** Go to the authorization request and wait for one of Loam's OAuth pages; its response's policy too. */
async function arrive(
	page: Page,
	kind: 'login' | 'consent',
	url = authorize()
): Promise<string | null> {
	const answered = page.waitForResponse((response: Response) =>
		new URL(response.url()).pathname.endsWith(`/~/oauth/${kind}`)
	);
	await page.goto(url);
	const response = await answered;
	await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
	await page.waitForFunction(() =>
		Boolean(document.querySelector('loam-oauth-page')?.shadowRoot?.querySelector('h1')?.textContent)
	);
	return response.headers()['content-security-policy'] ?? null;
}

async function signedIn(email: string): Promise<ShellPage> {
	const shell = await openShell(browser, site.root);
	opened.push(shell);
	const answer = (await kernelCall(shell.page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean };
	expect(answer.success).toBe(true);
	return shell;
}

describe('P3-E20: the consent page (9.4)', () => {
	it('P3-E20: shows who asks, in whose words, for what, and where it returns, with the loopback and write warnings', async () => {
		const { page } = await signedIn('bea@example.com');
		const policy = await arrive(page, 'consent');
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("form-action 'self'");
		const text = await pageText(page);
		expect(text).toContain('Connect Claude Code to Acme?');
		// A client the deployer registered has no metadata document's host: said so, in bold.
		const bold = await page.locator('loam-oauth-page strong').first().textContent();
		expect(bold).toBe('an app registered by the deployer');
		expect(text).toContain('Claude Code (name given by the app)');
		expect(text).toContain('Read what you can read in Acme');
		expect(text).toContain('Change what you can change in Acme');
		expect(text).toContain('127.0.0.1:9');
		expect(text).toContain(
			'This app runs on your own computer. Connect it only if you started it yourself.'
		);
		expect(text).toContain('Connecting it creates an agent you sponsor, which owners can see.');
		expect(text).toContain(
			'This agent can make any change you can make in Acme, without asking you first.'
		);
		expect(await axe(page)).toEqual([]);
	});

	it("P3-E20: a client id that is a metadata document's URL is shown by that URL's host, in bold", async () => {
		const { page } = await signedIn('bea@example.com');
		// The page reads the request from its own address, as the provider's redirect gives it.
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: 'https://tools.example.org/oauth/client.json',
			redirect_uri: REDIRECT,
			scope: 'loam:read',
			state: 'e20',
		});
		await page.goto(`${site.root}~/oauth/consent?${query}`);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
		await page.waitForFunction(() =>
			Boolean(
				document.querySelector('loam-oauth-page')?.shadowRoot?.querySelector('h1')?.textContent
			)
		);
		expect(await page.locator('loam-oauth-page strong').first().textContent()).toBe(
			'tools.example.org'
		);
		expect(await pageText(page)).not.toContain('registered by the deployer');
		expect(await axe(page)).toEqual([]);
	});

	it('P3-E20: `offline_access` is said in words, and a `localhost` redirect has the loopback warning', async () => {
		const { page } = await signedIn('bea@example.com');
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: host().clients['Claude Code'] as string,
			redirect_uri: 'http://localhost:8123/callback',
			scope: 'loam:read offline_access',
			state: 'e20',
		});
		// The page reads the request from its own address, as the provider's redirect gives it.
		await page.goto(`${site.root}~/oauth/consent?${query}`);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
		await page.waitForFunction(() =>
			Boolean(
				document.querySelector('loam-oauth-page')?.shadowRoot?.querySelector('h1')?.textContent
			)
		);
		const text = await pageText(page);
		expect(text).toContain('Stay connected until you disconnect it');
		expect(text).not.toContain('offline_access');
		expect(text).toContain('localhost:8123');
		expect(text).toContain(
			'This app runs on your own computer. Connect it only if you started it yourself.'
		);
	});

	it('P3-E20: a read-only request says nothing of changes', async () => {
		const { page } = await signedIn('bea@example.com');
		await arrive(page, 'consent', authorize('loam:read'));
		const text = await pageText(page);
		expect(text).toContain('Read what you can read in Acme');
		expect(text).not.toContain('Change what you can change');
		expect(text).not.toContain('without asking you first');
	});

	it('P3-E20: Deny returns `access_denied` to the client, and connects nothing', async () => {
		const { page } = await signedIn('bea@example.com');
		await arrive(page, 'consent');
		const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
		await page.locator('loam-oauth-page button', { hasText: 'Deny' }).click();
		const returned = new URL((await back).url());
		expect(returned.searchParams.get('error')).toBe('access_denied');
		expect(host().db().prepare('SELECT * FROM loam_connected_agent').all()).toEqual([]);
	});

	it('P3-E20: Connect returns a code to the client and makes the agent Bea sponsors', async () => {
		const { page } = await signedIn('bea@example.com');
		await arrive(page, 'consent');
		const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
		await page.locator('loam-oauth-page button', { hasText: 'Connect' }).click();
		expect(new URL((await back).url()).searchParams.get('code')).toBeTruthy();
		const rows = host().db().prepare('SELECT sponsor, status FROM loam_connected_agent').all() as {
			sponsor: string;
			status: string;
		}[];
		expect(rows).toEqual([{ sponsor: host().people['bea@example.com'], status: 'active' }]);
	});
});

describe("#2784: the agents tab changes a connected agent's access (9.2, 5.3)", () => {
	it('#2784: Change access asks in a labelled dialog; "Only these projects" writes the ids, Escape changes nothing, and "Every project" widens it again', async () => {
		// Bea's agent: the consent case above connects it; run alone, this case connects it itself, in a page of its own.
		const connected = () =>
			host()
				.db()
				.prepare('SELECT agentId FROM loam_connected_agent WHERE sponsor = ?')
				.get(host().people['bea@example.com'] as string);
		if (!connected()) {
			const consent = (await signedIn('bea@example.com')).page;
			await arrive(consent, 'consent');
			const back = consent.waitForRequest((request) => request.url().startsWith(REDIRECT));
			await consent.locator('loam-oauth-page button', { hasText: 'Connect' }).click();
			await back;
		}
		expect(connected()).toBeTruthy();
		const shell = await signedIn('bea@example.com');
		const { page } = shell;
		const atlas = (await kernelCall(page, 'project-create', { name: 'Atlas' })) as {
			success: boolean;
			data?: { id: string };
		};
		expect(atlas.success).toBe(true);
		expect(
			((await kernelCall(page, 'project-create', { name: 'Beacon' })) as { success: boolean })
				.success
		).toBe(true);
		const access = () =>
			JSON.parse(
				(
					host()
						.db()
						.prepare('SELECT access FROM loam_connected_agent WHERE sponsor = ?')
						.get(host().people['bea@example.com'] as string) as { access: string }
				).access
			);
		expect(access()).toEqual({ workspace: true, projects: 'sponsor' });
		await kernelCall(page, 'section-open', { section: 'account', path: 'agents' });
		const section = page.locator('loam-shell').locator('loam-main loam-account-section');
		const cells = () => section.locator('td').allTextContents();
		const whole = 'Every project you can open, and workspace-wide work';
		await expect.poll(cells).toContain(whole);
		const change = section.getByRole('button', { name: 'Change access for Claude Code' });
		const dialog = section.getByRole('dialog', { name: 'Where can Claude Code act?' });

		await change.click();
		await dialog.waitFor();
		// Focus starts on the choice that holds now; the project list is disabled until "Only these projects".
		await expect
			.poll(async () => {
				const { tag, hosts } = await focused(page);
				const id = await page.evaluate(() => {
					let element: Element | null = document.activeElement;
					while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
					return element?.id ?? '';
				});
				return [tag, hosts.at(-1), id];
			})
			.toEqual(['input', 'loam-account-section', 'access-all']);
		await expect
			.poll(() => dialog.getByRole('radio', { name: 'Every project you can open' }).isChecked())
			.toBe(true);
		expect(await dialog.getByRole('checkbox', { name: 'Atlas' }).isDisabled()).toBe(true);
		expect(await axe(page)).toEqual([]);
		await dialog.getByRole('radio', { name: 'Only these projects' }).check();
		await dialog.getByRole('checkbox', { name: 'Atlas' }).check();
		await dialog.getByRole('button', { name: 'Save access' }).click();
		await expect
			.poll(() => section.locator('.status').textContent())
			.toBe('Claude Code can act in: Workspace-wide work, and only Atlas.');
		// Focus returns to the row's Change access, built again by the read.
		await expect
			.poll(async () => (await focused(page)).label)
			.toBe('Change access for Claude Code');
		await expect.poll(cells).toContain('Workspace-wide work, and only Atlas');
		expect(access()).toEqual({ workspace: true, projects: [atlas.data?.id] });

		// Escape cancels: nothing is written.
		await change.click();
		await dialog.waitFor();
		expect(await dialog.getByRole('checkbox', { name: 'Atlas' }).isChecked()).toBe(true);
		await page.keyboard.press('Escape');
		await expect.poll(() => dialog.count()).toBe(0);
		expect(access()).toEqual({ workspace: true, projects: [atlas.data?.id] });

		// Changed elsewhere while the dialog is open (another tab): Save is refused, nothing is written, and the tab
		// reads it again and says so.
		await change.click();
		await dialog.getByRole('radio', { name: 'Every project you can open' }).check();
		const elsewhere = (await kernelCall(page, 'account-agent-update', {
			agent: (connected() as { agentId: string }).agentId,
			access: { workspace: false, projects: [] },
		})) as { success: boolean };
		expect(elsewhere.success).toBe(true);
		await dialog.getByRole('button', { name: 'Save access' }).click();
		await expect
			.poll(() => section.locator('.status').textContent())
			.toBe("Claude Code's access changed elsewhere. It is shown as it is now; choose again.");
		await expect.poll(cells).toContain('Nothing');
		expect(access()).toEqual({ workspace: false, projects: [] });
		await expect
			.poll(async () => (await focused(page)).label)
			.toBe('Change access for Claude Code');

		await change.click();
		await dialog.getByRole('radio', { name: 'Every project you can open' }).check();
		await dialog.getByRole('checkbox', { name: /^Workspace-wide work too/ }).check();
		await dialog.getByRole('button', { name: 'Save access' }).click();
		await expect.poll(cells).toContain(whole);
		expect(access()).toEqual({ workspace: true, projects: 'sponsor' });

		// Disconnected elsewhere while the dialog is open: Save is refused, the tab reads again (the row is gone), and
		// focus goes to the section's heading rather than to the page.
		await change.click();
		await dialog.getByRole('radio', { name: 'Every project you can open' }).check();
		const gone = (await kernelCall(page, 'account-agent-disconnect', {
			agent: (connected() as { agentId: string }).agentId,
		})) as { success: boolean };
		expect(gone.success).toBe(true);
		await dialog.getByRole('button', { name: 'Save access' }).click();
		await expect.poll(() => change.count()).toBe(0);
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
		expect(await section.locator('.status').textContent()).toMatch(/connected agent/i);
		expect(await axe(page)).toEqual([]);
		expect(shell.errors).toEqual([]);
		expect(shell.violations).toEqual([]);
	});
});

describe('P3-E11: the consent page by keyboard (9.4, 14)', () => {
	it('P3-E11: focus starts on the heading; Tab reaches Connect, then Deny; Enter on Deny returns `access_denied`', async () => {
		const { page } = await signedIn('cy@example.com');
		await arrive(page, 'consent', authorize('loam:read'));
		expect((await focused(page)).tag).toBe('h1');
		await page.keyboard.press('Tab');
		expect(await focused(page)).toMatchObject({ tag: 'button', label: 'Connect' });
		await page.keyboard.press('Tab');
		expect(await focused(page)).toMatchObject({ tag: 'button', label: 'Deny' });
		const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
		await page.keyboard.press('Enter');
		expect(new URL((await back).url()).searchParams.get('error')).toBe('access_denied');
		expect(
			host()
				.db()
				.prepare('SELECT * FROM loam_connected_agent WHERE sponsor = ?')
				.all(host().people['cy@example.com'] as string)
		).toEqual([]);
	});

	it('P3-E11: Enter on Connect, reached by Tab, returns a code and connects the agent', async () => {
		const { page } = await signedIn('dee@example.com');
		await arrive(page, 'consent', authorize('loam:read'));
		await page.keyboard.press('Tab');
		expect(await focused(page)).toMatchObject({ tag: 'button', label: 'Connect' });
		const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
		await page.keyboard.press('Enter');
		expect(new URL((await back).url()).searchParams.get('code')).toBeTruthy();
		expect(
			host()
				.db()
				.prepare('SELECT status FROM loam_connected_agent WHERE sponsor = ?')
				.all(host().people['dee@example.com'] as string)
		).toEqual([{ status: 'active' }]);
	});
});

describe('P3-E20: the login page (9.4)', () => {
	it('P3-E20: signs in, passkey first, and resumes the authorization at the provider', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		opened.push({ context } as ShellPage);
		const page = await context.newPage();
		const policy = await arrive(page, 'login');
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("form-action 'self'");
		await expect
			.poll(async () => (await page.locator('loam-oauth-page button').allTextContents())[0])
			.toBe('Sign in with a passkey');
		expect(await axe(page)).toEqual([]);
		await page.locator('loam-oauth-page input[name="email"]').fill('olu@example.com');
		await page.locator('loam-oauth-page input[name="password"]').fill(PASSWORD);
		const consent = page.waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith('/~/oauth/consent')
		);
		await page.locator('loam-oauth-page button[type="submit"]').click();
		await consent;
		await page.waitForFunction(() =>
			(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').includes(
				'Connect Claude Code'
			)
		);
	});

	it("P3-E20: a client's `prompt=login` with a session present asks for a sign-in, and then resumes, never looping", async () => {
		const { page } = await signedIn('cy@example.com');
		await arrive(page, 'login', authorize('loam:read', { prompt: 'login' }));
		await page.locator('loam-oauth-page input[name="email"]').fill('cy@example.com');
		await page.locator('loam-oauth-page input[name="password"]').fill(PASSWORD);
		const consent = page.waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith('/~/oauth/consent')
		);
		await page.locator('loam-oauth-page button[type="submit"]').click();
		await consent;
		await page.waitForFunction(() =>
			(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').includes(
				'Connect Claude Code'
			)
		);
	});
});
