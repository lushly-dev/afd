/**
 * P5-A6 on the desktop's `http` lane (phase 5 specification, 7.2; #2137): `mailfix` served over HTTP
 * (`fixtures/mailfix-http.ts`) and mounted from `mounts.json` with the deployer's bearer, its entry saying
 * `approvals = "shell"` and naming `mailfix-draft-show` as the send's preview, and the server naming the bearer's
 * caller, Loam's Rust host, its approver (AFD's carrier, step 0c). The desktop's transport opens it on MCP 2026-07-28,
 * and the Rust host sends the era's headers with no session.
 *
 * What this proves, over the real carrier on `http`: the instance is opened on 2026-07-28 and every request names the
 * era in its header; an agent's send is asked once, with the server's preview, and nothing is sent; the person's
 * confirm sends it once; the approval token is in no result, no page text and nothing the page stores. What it does
 * not prove: the headers' derivation (the desktop crate's `era` units and `tests/http_approvals.rs`, which also show no
 * token reaches the host's log), or the kernel (its units). Every wait is a poll with a deadline.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MailfixHttp, startMailfixHttp } from './fixtures/mailfix-http';
import {
	type Desktop,
	desktopDeployment,
	openDesktop,
	packApp,
	pageText,
	storedText,
	untilInstance,
} from './harness';

const BEARER = 'loam-desktop-approvals-bearer-2137';

let desktop: Desktop;
let mailfix: MailfixHttp;

async function apps(): Promise<string[]> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-desktop-approvals-http-'));
	const tokenFile = join(directory, 'token');
	await writeFile(tokenFile, BEARER, { mode: 0o600 });
	const app = await packApp(
		fileURLToPath(new URL('./fixtures/apps/mailfix-http', import.meta.url))
	);
	return [
		'[apps.mailfix]',
		'app = "mailfix"',
		`package = ${JSON.stringify(app)}`,
		'transport = "http"',
		`url = ${JSON.stringify(mailfix.url)}`,
		`bearer_file = ${JSON.stringify(tokenFile)}`,
		'audience = "person"',
		'labels = "per-part"',
		'approvals = "shell"',
		'',
		'[apps.mailfix.commands."mailfix-draft-create"]',
		'expose = { agent = true, palette = true }',
		'',
		'[apps.mailfix.commands."mailfix-draft-send"]',
		'expose = { agent = true }',
		'preview = { command = "mailfix-draft-show", input = ["draft"] }',
	];
}

type Notice = {
	id: string;
	confirmation?: {
		command: string;
		state: string;
		preview?: { command: string; digest: string; data?: { draft?: string } };
	};
};

const sent = async () =>
	((await desktop.call('mailfix-sent-list', {})).data as { sent: unknown[] } | undefined)?.sent;

beforeAll(async () => {
	mailfix = await startMailfixHttp(BEARER);
	desktop = await openDesktop({ deployment: desktopDeployment(await apps()) });
	await untilInstance(desktop, 'mailfix', 'ready');
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	await mailfix?.close();
});

describe('P5-A6: mounted approvals on the desktop over http (#2137)', () => {
	it('P5-A6: opens the instance on MCP 2026-07-28 over http, every request naming the era', async () => {
		const listed = await desktop.call('app-instance-list');
		const row = (
			listed.data as {
				instances: { instance: string; protocolVersion?: string; warnings: { code: string }[] }[];
			}
		).instances.find((each) => each.instance === 'mailfix');
		expect(row?.protocolVersion).toBe('2026-07-28');
		expect(row?.warnings.map((each) => each.code)).not.toContain('INSTANCE_APPROVALS_UNAVAILABLE');
		expect(mailfix.versions.length).toBeGreaterThan(0);
		expect(new Set(mailfix.versions)).toEqual(new Set(['2026-07-28']));
	});

	it("P5-A6: an agent's send is asked once with the preview; the person's confirm sends it once; no token is anywhere", async () => {
		const made = await desktop.call('mailfix-draft-create', {
			thread: 'thr_1',
			body: 'See you Thursday.',
		});
		expect(made).toMatchObject({ success: true, data: { draft: 'drf_1', revision: 1 } });
		const asked = await desktop.agentCall('mailfix-draft-send', { draft: 'drf_1', revision: 1 });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const id = (asked.error as { details?: { notification?: string } }).details?.notification;
		expect(id).toMatch(/^ntf_/);
		expect(await sent()).toEqual([]);

		const listed = await desktop.call('notification-list', { kind: 'confirmation', body: true });
		const notices = (listed.data as { notifications: Notice[] }).notifications;
		expect(notices).toHaveLength(1);
		expect(notices[0]?.confirmation).toMatchObject({
			command: 'mailfix-draft-send',
			state: 'pending',
			preview: { command: 'mailfix-draft-show', data: { draft: 'drf_1' } },
		});

		const answered = await desktop.call('notification-act', {
			notification: id,
			answer: 'confirm',
		});
		expect(answered).toMatchObject({ success: true, data: { state: 'confirmed' } });
		expect(await sent()).toHaveLength(1);

		// AFD's tokens begin `afdap1.`: none in what the page shows, stores or was answered.
		expect(await pageText(desktop.browser)).not.toContain('afdap1.');
		expect(await storedText(desktop.browser)).not.toContain('afdap1.');
		expect(JSON.stringify([asked, listed, answered])).not.toContain('afdap1.');
		// Nor the app's stderr, through Tauri's real IPC protocol handler, nor the bearer.
		const logged = desktop.stderr.lines.join('\n');
		expect(logged).not.toContain('afdap1.');
		expect(logged).not.toContain(BEARER);
	});
});
