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

describe('P3-E20: the login page (9.4)', () => {
	it('P3-E20: signs in, passkey first, and resumes the authorization at the provider', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		opened.push({ context } as ShellPage);
		const page = await context.newPage();
		const policy = await arrive(page, 'login');
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("form-action 'self'");
		const buttons = await page.locator('loam-oauth-page button').allTextContents();
		expect(buttons[0]).toBe('Sign in with a passkey');
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
