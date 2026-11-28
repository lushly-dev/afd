/**
 * P3-E11's axe matrix (phase 3 specification, 14): phase 0's tags, as `axe()` runs them, over section 14's elements
 * and pages. The shell's parts (the sign-in dialog, the account menu, and the account section's every tab: profile,
 * passkeys, sessions, members and agents) in every theme and density, under forced colors and in the compact
 * class; the join, recovery, OAuth login and consent pages, which boot no kernel and show the profile's last
 * appearance or the system's (R9), in every theme and density the profile had, with the system's dark mode, under
 * forced colors and at the compact class's width, and on a fresh profile as the system changes. Through a test-only auth host: a real
 * Better Auth 1.7.18 server behind the shell's own HTTPS origin, which proves no hosted lane (2.4).
 */

import type { Browser, BrowserContextOptions, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	kernelCall,
	launchForDevHost,
	openPage,
	openShell,
	providerDeployment,
	type ShellPage,
	serveDeployment,
	settle,
} from '../harness';

const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'http://127.0.0.1:9/callback';
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
const TABS = ['profile', 'passkeys', 'sessions', 'personas', 'members', 'agents'] as const;

let browser: Browser;
let site: DeploymentSite;
const opened: ShellPage[] = [];
let joinLink = '';
let recoverLink = '';

const host = () => site.authHost as NonNullable<DeploymentSite['authHost']>;

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
			clients: [{ name: 'Claude Code', redirect: REDIRECT }],
		},
	});
	browser = await launchForDevHost({ spki: site.spki as string });
	// One join and one recovery link, opened by every case below and never used, so each stays valid.
	const owner = await openShell(browser, site.root);
	opened.push(owner);
	await signIn(owner.page, 'olu@example.com');
	await kernelCall(owner.page, 'member-invite', { email: 'newcomer@example.com', role: 'member' });
	joinLink = await mailed('newcomer@example.com');
	const asked = await owner.page.evaluate(async () => {
		const response = await fetch(new URL('api/auth/loam/recover/request', document.baseURI), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'bea@example.com' }),
		});
		return response.status;
	});
	expect(asked).toBe(200);
	recoverLink = await mailed('bea@example.com');
});
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await site?.close();
});

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

/** The last link the provider mailed to `email`, waited for in setup, where `expect.poll` may not run. */
async function mailed(email: string): Promise<string> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const mail = (await host().mail()).filter((message) => message.to === email).at(-1);
		const found = mail ? /https:\/\/\S+/.exec(mail.text)?.[0] : undefined;
		if (found) return found;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`No link was mailed to ${email}`);
}

const shadow = (page: Page, selector: string) => page.locator('loam-shell').locator(selector);

/** Set the person's appearance and check the page shows it: the theme and the density on the document element. */
async function appear(page: Page, appearance: { theme: string; density: string }): Promise<void> {
	const set = (await kernelCall(page, 'appearance-set', appearance)) as {
		success: boolean;
		error?: unknown;
	};
	expect(set.success, JSON.stringify(set.error)).toBe(true);
	await settle(page);
	expect(
		await page.evaluate(() => [
			document.documentElement.dataset.loamTheme,
			document.documentElement.dataset.loamDensity ?? 'comfortable',
		])
	).toEqual([appearance.theme, appearance.density]);
}

/**
 * axe once no transition runs: a quiet button's hover fades its background, and a sample taken mid-fade measures a
 * color that is never at rest (seen: the account button at `rgba(255, 255, 255, 0.937)` under forced colors).
 */
async function axeAtRest(page: Page, except: string[] = []) {
	// The document's and every shadow root's, so a part's own transition is waited for too.
	await page.waitForFunction(() => {
		const roots: Array<Document | ShadowRoot> = [document];
		for (let index = 0; index < roots.length; index++)
			for (const node of (roots[index] as Document | ShadowRoot).querySelectorAll('*'))
				if (node.shadowRoot) roots.push(node.shadowRoot);
		return roots.every((root) =>
			root.getAnimations().every((animation) => animation.playState !== 'running')
		);
	});
	return axe(page, except);
}

/** Under forced colors, the emulation really applies: the media query matches. */
async function forcedApplies(page: Page, options: BrowserContextOptions): Promise<void> {
	if (options.forcedColors === 'active')
		expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
}

/** What each account tab shows once its reads are in, so axe runs on the tab, not on its loading state. */
const TAB_READY: Record<(typeof TABS)[number], string> = {
	profile: 'Save name',
	passkeys: 'Add a passkey',
	sessions: 'Where you are signed in',
	personas: 'Make persona',
	members: 'Invite a person',
	agents: 'Apps you connected over MCP act for you',
};

/** Section 14's shell parts, each under axe: signed out, the sign-in dialog; signed in, the menu and every tab. */
async function shellParts(
	options: BrowserContextOptions,
	appearance?: { theme: string; density: string }
) {
	const shell = await openShell(browser, site.root, { reducedMotion: 'reduce', ...options });
	opened.push(shell);
	const { page } = shell;
	await forcedApplies(page, options);
	if (appearance) await appear(page, appearance);
	const checked: string[] = [];
	await shadow(page, 'loam-main .sign-in').click();
	await shadow(page, 'loam-sign-in-dialog dialog[open]').waitFor();
	expect(await axeAtRest(page), 'sign-in dialog').toEqual([]);
	checked.push('sign-in dialog');
	await page.keyboard.press('Escape');
	await signIn(page, 'olu@example.com');
	// The person's own appearance arrives with the sign-in: set it again, as theirs, before the signed-in parts.
	if (appearance) await appear(page, appearance);
	// Opened from the keyboard, as section 14's menu button is: a mouse left over the button keeps it hovered, and
	// under forced colors axe measures the hover's fading background as if it lay over the text.
	await page.mouse.move(0, 0);
	await shadow(page, 'loam-titlebar .account').focus();
	await page.keyboard.press('Enter');
	await shadow(page, 'loam-account-menu').getByRole('menuitem', { name: 'Sign out' }).waitFor();
	expect(await axeAtRest(page), 'account menu').toEqual([]);
	checked.push('account menu');
	await page.keyboard.press('Escape');
	const section = shadow(page, 'loam-main loam-account-section');
	for (const tab of TABS) {
		expect(
			(await kernelCall(page, 'section-open', { section: 'account', path: tab })) as {
				success: boolean;
			}
		).toMatchObject({ success: true });
		await expect
			.poll(() => section.locator('[role="tab"][aria-selected="true"]').getAttribute('id'))
			.toBe(`tab-${tab}`);
		await expect
			.poll(() => section.locator('[role="tabpanel"]').textContent())
			.toContain(TAB_READY[tab]);
		await settle(page);
		expect(await axeAtRest(page), `account section, ${tab}`).toEqual([]);
		checked.push(tab);
	}
	expect(shell.violations).toEqual([]);
	await shell.context.close();
	return checked;
}

/** The theme and density a page shows, read from its document element. */
const shown = (page: Page) =>
	page.evaluate(() => [
		document.documentElement.dataset.loamTheme,
		document.documentElement.dataset.loamDensity ?? 'comfortable',
	]);

/**
 * The join, recovery, login and consent pages, each under axe, every rule, once its own heading and primary action
 * show, in the appearance this profile's shell last had (R9): set on a signed-out shell for the first three, and as Bea's
 * own, signed in, for the consent page. Under forced colors each shows high contrast, as the shell does.
 */
async function pages(
	options: BrowserContextOptions,
	appearance?: { theme: string; density: string }
) {
	const expected = (density: string) => [
		// Under forced colors, high contrast; else the profile's theme; with none, the system's, as `system` resolves it.
		options.forcedColors === 'active'
			? 'high-contrast'
			: (appearance?.theme ?? (options.colorScheme === 'dark' ? 'dark' : 'light')),
		density,
	];
	const shell = await openShell(browser, site.root, { reducedMotion: 'reduce', ...options });
	opened.push(shell);
	await forcedApplies(shell.page, options);
	if (appearance) await appear(shell.page, appearance);
	const density = appearance?.density ?? 'comfortable';
	const checked: string[] = [];
	const visit = async (url: string) => {
		const page = await openPage(browser, url, {}, shell.context);
		opened.push(page);
		return page;
	};
	for (const [name, url, heading] of [
		['join', joinLink, 'Join Acme'],
		['recovery', recoverLink, 'Restore your access'],
	] as const) {
		const page = await visit(url);
		await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		await expect.poll(() => page.page.locator('loam-link-page h1').textContent()).toBe(heading);
		await page.page
			.locator('loam-link-page')
			.getByRole('button', { name: 'Create a passkey' })
			.waitFor();
		expect(await shown(page.page), name).toEqual(expected(density));
		expect(await axeAtRest(page.page), name).toEqual([]);
		expect([...page.violations, ...page.errors], name).toEqual([]);
		checked.push(name);
		await page.page.close();
	}
	const authorize = `${site.root}api/auth/oauth2/authorize?${new URLSearchParams({
		response_type: 'code',
		client_id: host().clients['Claude Code'] as string,
		redirect_uri: REDIRECT,
		scope: 'loam:read loam:write offline_access',
		state: 'axe',
		code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		code_challenge_method: 'S256',
		resource: `${site.root}mcp`,
	})}`;
	// Signed out, the login page.
	const visitor = await visit(authorize);
	await visitor.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
	await visitor.page
		.locator('loam-oauth-page')
		.getByRole('button', { name: 'Sign in with a passkey' })
		.waitFor();
	expect(await shown(visitor.page), 'login').toEqual(expected(density));
	expect(await axeAtRest(visitor.page), 'login').toEqual([]);
	expect([...visitor.violations, ...visitor.errors], 'login').toEqual([]);
	checked.push('login');
	await visitor.page.close();
	// Signed in as Bea, whose own appearance the shell then keeps as the profile's last: the consent page.
	await signIn(shell.page, 'bea@example.com');
	if (appearance) await appear(shell.page, appearance);
	const person = await visit(authorize);
	await person.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
	await person.page.locator('loam-oauth-page').getByRole('button', { name: 'Connect' }).waitFor();
	expect(await person.page.locator('loam-oauth-page h1').textContent()).toBe(
		'Connect Claude Code to Acme?'
	);
	expect(await shown(person.page), 'consent').toEqual(expected(density));
	expect(await axeAtRest(person.page), 'consent').toEqual([]);
	expect([...person.violations, ...person.errors], 'consent').toEqual([]);
	checked.push('consent');
	await shell.context.close();
	return checked;
}

describe("P3-E11: axe over phase 3's elements and pages", () => {
	for (const theme of THEMES)
		for (const density of DENSITIES)
			it(`P3-E11: the sign-in dialog, the account menu and every account tab have no violations in ${theme}, ${density}`, async () => {
				expect(
					await shellParts({ viewport: { width: 1280, height: 800 } }, { theme, density })
				).toEqual(['sign-in dialog', 'account menu', ...TABS]);
			}, 120_000);

	it('P3-E11: the shell parts have no violations under forced colors, and in the compact class', async () => {
		expect(
			await shellParts({ viewport: { width: 1280, height: 800 }, forcedColors: 'active' })
		).toEqual(['sign-in dialog', 'account menu', ...TABS]);
		expect(await shellParts({ viewport: { width: 390, height: 844 } })).toEqual([
			'sign-in dialog',
			'account menu',
			...TABS,
		]);
	}, 180_000);

	for (const theme of THEMES)
		for (const density of DENSITIES)
			it(`P3-E11: the join, recovery, login and consent pages show the profile's ${theme}, ${density}, with no violations`, async () => {
				expect(await pages({ viewport: { width: 1280, height: 800 } }, { theme, density })).toEqual(
					['join', 'recovery', 'login', 'consent']
				);
			}, 120_000);

	it('P3-E11: the pages follow the system with no appearance of the profile, under forced colors, and at the compact width', async () => {
		for (const options of [
			{ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const },
			{ viewport: { width: 1280, height: 800 }, forcedColors: 'active' as const },
			{ viewport: { width: 390, height: 844 } },
		])
			expect(await pages(options)).toEqual(['join', 'recovery', 'login', 'consent']);
	}, 240_000);

	it("P3-E11: a fresh profile's join page shows the system's theme, makes no database, and follows the system as it changes", async () => {
		// No shell has run in this profile: there is no `loam-store` to read, and the page must not make one.
		const page = await openPage(browser, joinLink, {
			viewport: { width: 1280, height: 800 },
			reducedMotion: 'reduce',
		});
		opened.push(page);
		await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		await expect.poll(() => page.page.locator('loam-link-page h1').textContent()).toBe('Join Acme');
		expect(await shown(page.page)).toEqual(['light', 'comfortable']);
		expect(
			await page.page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name))
		).not.toContain('loam-store');
		// The system turns dark, and then to forced colors, while the page is open.
		await page.page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(() => shown(page.page)).toEqual(['dark', 'comfortable']);
		await page.page.emulateMedia({ forcedColors: 'active' });
		await expect.poll(() => shown(page.page)).toEqual(['high-contrast', 'comfortable']);
		expect(await axeAtRest(page.page)).toEqual([]);
		expect([...page.violations, ...page.errors]).toEqual([]);
		await page.context.close();
	});
});
