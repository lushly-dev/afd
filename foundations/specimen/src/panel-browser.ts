/**
 * Real Playwright/Chromium modality-enforced execution host for `panel-walk`.
 *
 * Enforces network/SSRF origin confinement, injects optional `appDate` clock pinning,
 * executes ONLY the tools permitted by the persona's modality (never exposing raw DOM,
 * selectors, CSS source, or screenshots to screen-reader walks), and observes rendered
 * interaction behavior directly in Chromium.
 */

import type { Browser, CDPSession, Page } from 'playwright';
import type { SpecimenHostError } from './host.js';
import type {
	ModalityToolbox,
	PanelWalkDriverContext,
	PanelWalkDriverResult,
	WalkFinding,
	WalkJournalEntry,
} from './panel-types.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error = new Error(message) as SpecimenHostError;
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

function normalizedOrigin(url: URL): string {
	const implied = url.protocol === 'https:' ? ':443' : ':80';
	return `${url.protocol}//${url.host}${url.port ? '' : implied}`.toLowerCase();
}

/**
 * Verify that `targetUrl` is an `http:` or `https:` URL pointing to loopback or an origin
 * explicitly allowed in `specimen.config.json` (`network.allow`).
 */
export function assertWalkTargetAllowed(
	targetUrl: string,
	allowedOrigins: readonly string[] = []
): URL {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid walk target URL '${targetUrl}'.`,
			'Pass a well-formed http:// or https:// URL pointing to a local or allowed application origin.'
		);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw typedError(
			'VALIDATION_ERROR',
			`Unsupported target scheme '${parsed.protocol}' in '${targetUrl}'.`,
			'Use an http:// or https:// target URL.'
		);
	}
	if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
		return parsed;
	}
	const origin = normalizedOrigin(parsed);
	const allowed = new Set(allowedOrigins.map((entry) => entry.toLowerCase()));
	if (!allowed.has(origin)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Target origin '${parsed.origin}' is not allowed by network policy.`,
			'Target a localhost/127.0.0.1 application or add the origin to network.allow in specimen.config.json.',
			{ origin: parsed.origin }
		);
	}
	return parsed;
}

interface ClickObservation {
	targets: Array<{
		label: string;
		role: string;
		x: number;
		y: number;
		interceptedByCover: boolean;
		clippedOutsideContainer: boolean;
		respondedToClick: boolean;
		respondedToDoubleClick: boolean;
	}>;
}

interface KeyboardObservation {
	focusSteps: Array<{
		label: string;
		role: string;
		top: number;
		left: number;
		focusVisible: boolean;
		transparentOnFocus: boolean;
	}>;
	orderInversions: Array<{ previous: string; current: string }>;
}

interface ViewportObservation {
	viewportWidth: number;
	scrollWidth: number;
	horizontalOverflowPx: number;
	clippedControls: Array<{ label: string; reason: string }>;
	hiddenMessagesAtNarrow: Array<{ text: string; reason: string }>;
}

interface ScreenReaderObservation {
	duplicateControls: Array<{ name: string; role: string; count: number }>;
	silentStatusUpdates: Array<{ changedText: string }>;
	ariaHiddenMessages: Array<{ text: string }>;
	landmarks: number;
	headings: number;
}

interface AXNodeInfo {
	role?: { value?: string };
	name?: { value?: string };
	ignored?: boolean;
}

/**
 * Create a Playwright-backed tool executor bound to a live Chromium page.
 * Each tool implements strictly what that modality is allowed to perceive or act on.
 */
export function createPlaywrightToolExecutor(
	page: Page,
	cdp: CDPSession
): (tool: string, input?: Record<string, unknown>) => Promise<unknown> {
	const axCursor: { nodes: Array<{ role: string; name: string }>; index: number } = {
		nodes: [],
		index: 0,
	};

	const refreshAxNodes = async () => {
		const tree = (await cdp.send('Accessibility.getFullAXTree')) as { nodes?: AXNodeInfo[] };
		const nodes: Array<{ role: string; name: string }> = [];
		for (const node of tree.nodes ?? []) {
			if (node.ignored) continue;
			const role = String(node.role?.value ?? '');
			const name = String(node.name?.value ?? '').trim();
			if (!role || role === 'none' || role === 'generic' || role === 'InlineTextBox') continue;
			nodes.push({ role, name });
		}
		axCursor.nodes = nodes;
		return nodes;
	};

	return async (tool: string, input?: Record<string, unknown>): Promise<unknown> => {
		switch (tool) {
			case 'screenshot': {
				const buf = await page.screenshot({ type: 'png' });
				const layout = await page.evaluate((): ViewportObservation => {
					const vw = window.innerWidth;
					const sw = Math.max(
						document.documentElement.scrollWidth,
						document.body ? document.body.scrollWidth : 0
					);
					const clippedControls: Array<{ label: string; reason: string }> = [];
					const interactive = Array.from(
						document.querySelectorAll<HTMLElement>(
							'button, a[href], input, select, textarea, [role="button"], [tabindex]'
						)
					);
					for (const el of interactive) {
						const style = getComputedStyle(el);
						if (style.display === 'none' || style.visibility === 'hidden') continue;
						const rect = el.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) continue;
						const label =
							el.getAttribute('aria-label')?.trim() ||
							el.textContent?.trim() ||
							el.tagName.toLowerCase();
						if (rect.right > vw + 1) {
							clippedControls.push({
								label,
								reason: `extends ${Math.round(rect.right - vw)}px past the ${vw}px viewport edge`,
							});
							continue;
						}
						// Walk ancestors checking clip/hidden overflow truncation
						let parent = el.parentElement;
						while (parent && parent !== document.body) {
							const pStyle = getComputedStyle(parent);
							const pRect = parent.getBoundingClientRect();
							if (
								(pStyle.overflowX === 'clip' || pStyle.overflowX === 'hidden') &&
								(rect.right > pRect.right + 1 || rect.left < pRect.left - 1)
							) {
								clippedControls.push({
									label,
									reason: `horizontally clipped by ancestor container (${pStyle.overflowX})`,
								});
								break;
							}
							if (
								(pStyle.overflowY === 'clip' || pStyle.overflowY === 'hidden') &&
								(rect.bottom > pRect.bottom + 1 || rect.top < pRect.top - 1)
							) {
								clippedControls.push({
									label,
									reason: `vertically clipped by ancestor container (${pStyle.overflowY})`,
								});
								break;
							}
							parent = parent.parentElement;
						}
					}
					const hiddenMessagesAtNarrow: Array<{ text: string; reason: string }> = [];
					if (vw <= 400) {
						const candidates = Array.from(
							document.querySelectorAll<HTMLElement>(
								'[role="alert"], [role="status"], .error, .err, [data-error], p, span, div'
							)
						);
						for (const el of candidates) {
							if (el.children.length > 0) continue;
							const text = el.textContent?.trim() ?? '';
							if (!text || text.length > 160) continue;
							const style = getComputedStyle(el);
							if (style.display === 'none' || style.visibility === 'hidden') {
								// Check whether the element is explicitly hidden via CSS display/visibility
								// rather than having the HTML [hidden] attribute.
								if (!el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true') {
									hiddenMessagesAtNarrow.push({
										text,
										reason: `hidden by CSS (${style.display === 'none' ? 'display: none' : 'visibility: hidden'}) at ${vw}px viewport`,
									});
								}
							}
						}
					}
					return {
						viewportWidth: vw,
						scrollWidth: sw,
						horizontalOverflowPx: Math.max(0, sw - vw),
						clippedControls,
						hiddenMessagesAtNarrow,
					};
				});
				return { bytes: buf.byteLength, layout };
			}
			case 'click': {
				if (typeof input?.x === 'number' && typeof input?.y === 'number') {
					await page.mouse.click(input.x, input.y);
					return { clicked: { x: input.x, y: input.y } };
				}
				// Probe visible interactive controls via real hit-testing and mouse click
				const probes = await page.evaluate(() => {
					const controls = Array.from(
						document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')
					);
					const results: Array<{
						index: number;
						label: string;
						role: string;
						x: number;
						y: number;
						interceptedByCover: boolean;
						clippedOutsideContainer: boolean;
					}> = [];
					for (let i = 0; i < controls.length; i++) {
						const el = controls[i];
						if (!el) continue;
						const style = getComputedStyle(el);
						if (style.display === 'none' || style.visibility === 'hidden') continue;
						const rect = el.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) continue;
						const label =
							el.getAttribute('aria-label')?.trim() ||
							el.textContent?.trim() ||
							el.tagName.toLowerCase();
						const role = el.getAttribute('role') || el.tagName.toLowerCase();
						const cx = rect.left + rect.width / 2;
						const cy = rect.top + rect.height / 2;
						let clippedOutsideContainer = false;
						let parent = el.parentElement;
						while (parent && parent !== document.body) {
							const pStyle = getComputedStyle(parent);
							const pRect = parent.getBoundingClientRect();
							if (
								(pStyle.overflow === 'hidden' ||
									pStyle.overflow === 'clip' ||
									pStyle.overflowY === 'hidden' ||
									pStyle.overflowY === 'clip' ||
									pStyle.overflowX === 'hidden' ||
									pStyle.overflowX === 'clip') &&
								(cy > pRect.bottom || cy < pRect.top || cx > pRect.right || cx < pRect.left)
							) {
								clippedOutsideContainer = true;
								break;
							}
							parent = parent.parentElement;
						}
						const hit = document.elementFromPoint(cx, cy);
						const interceptedByCover =
							!clippedOutsideContainer &&
							hit !== null &&
							hit !== el &&
							!el.contains(hit) &&
							!hit.contains(el);
						results.push({
							index: i,
							label,
							role,
							x: cx,
							y: cy,
							interceptedByCover,
							clippedOutsideContainer,
						});
					}
					return results;
				});

				const targets: ClickObservation['targets'] = [];
				for (const probe of probes) {
					let respondedToClick = false;
					if (!probe.interceptedByCover && !probe.clippedOutsideContainer) {
						const before = await page.evaluate(() => ({
							text: document.body.textContent ?? '',
							attrs: document.body.innerHTML.length,
							clicks: (window as unknown as Record<string, unknown>).__panelClicks ?? 0,
						}));
						await page.mouse.click(probe.x, probe.y);
						await page.waitForTimeout(25);
						const after = await page.evaluate(() => ({
							text: document.body.textContent ?? '',
							attrs: document.body.innerHTML.length,
							clicks: (window as unknown as Record<string, unknown>).__panelClicks ?? 0,
						}));
						respondedToClick =
							before.text !== after.text ||
							before.attrs !== after.attrs ||
							before.clicks !== after.clicks;
					}
					targets.push({
						label: probe.label,
						role: probe.role,
						x: probe.x,
						y: probe.y,
						interceptedByCover: probe.interceptedByCover,
						clippedOutsideContainer: probe.clippedOutsideContainer,
						respondedToClick,
						respondedToDoubleClick: false,
					});
				}
				return { targets } satisfies ClickObservation;
			}
			case 'double_click': {
				if (typeof input?.x === 'number' && typeof input?.y === 'number') {
					const before = await page.evaluate(() => ({
						text: document.body.textContent ?? '',
						htmlLen: document.body.innerHTML.length,
					}));
					await page.mouse.dblclick(input.x, input.y);
					await page.waitForTimeout(25);
					const after = await page.evaluate(() => ({
						text: document.body.textContent ?? '',
						htmlLen: document.body.innerHTML.length,
					}));
					return {
						changed: before.text !== after.text || before.htmlLen !== after.htmlLen,
					};
				}
				return { changed: false };
			}
			case 'scroll': {
				const dx = typeof input?.dx === 'number' ? input.dx : 0;
				const dy = typeof input?.dy === 'number' ? input.dy : 200;
				await page.mouse.wheel(dx, dy);
				await page.waitForTimeout(20);
				return page.evaluate(() => ({
					scrollX: window.scrollX,
					scrollY: window.scrollY,
					scrollWidth: document.documentElement.scrollWidth,
					clientWidth: document.documentElement.clientWidth,
				}));
			}
			case 'press': {
				const key = typeof input?.key === 'string' ? input.key : 'Tab';
				if (key === 'Tab' && input?.probeFocusSequence === true) {
					const focusSteps: KeyboardObservation['focusSteps'] = [];
					const seen = new Set<string>();
					// Record unfocused styles of all focusable controls before tabbing
					await page.evaluate(() => {
						const focusable = Array.from(
							document.querySelectorAll<HTMLElement>(
								'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
							)
						);
						for (const el of focusable) {
							const st = getComputedStyle(el);
							el.dataset.__unfocusedStyle = JSON.stringify({
								outlineStyle: st.outlineStyle,
								outlineWidth: st.outlineWidth,
								outlineColor: st.outlineColor,
								boxShadow: st.boxShadow,
								borderColor: st.borderColor,
								backgroundColor: st.backgroundColor,
							});
						}
					});

					for (let step = 0; step < 20; step++) {
						await page.keyboard.press('Tab');
						const info = await page.evaluate(() => {
							const active = document.activeElement as HTMLElement | null;
							if (!active || active === document.body || active === document.documentElement) {
								return null;
							}
							const st = getComputedStyle(active);
							const rect = active.getBoundingClientRect();
							const label =
								active.getAttribute('aria-label')?.trim() ||
								active.textContent?.trim() ||
								active.getAttribute('name') ||
								active.tagName.toLowerCase();
							const role = active.getAttribute('role') || active.tagName.toLowerCase();
							const keyId = `${active.tagName}:${label}:${Math.round(rect.left)}:${Math.round(rect.top)}`;
							const transparentColor = (c: string) =>
								c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
							const transparentOnFocus =
								transparentColor(st.color) &&
								transparentColor(st.backgroundColor) &&
								(st.outlineStyle === 'none' || transparentColor(st.outlineColor));

							let prev: Record<string, string> | undefined;
							try {
								prev = active.dataset.__unfocusedStyle
									? (JSON.parse(active.dataset.__unfocusedStyle) as Record<string, string>)
									: undefined;
							} catch {
								prev = undefined;
							}
							const hasOutline =
								st.outlineStyle !== 'none' &&
								Number.parseFloat(st.outlineWidth) > 0 &&
								!transparentColor(st.outlineColor);
							const boxShadowChanged =
								prev !== undefined && st.boxShadow !== prev.boxShadow && st.boxShadow !== 'none';
							const borderChanged = prev !== undefined && st.borderColor !== prev.borderColor;
							const bgChanged =
								prev !== undefined &&
								st.backgroundColor !== prev.backgroundColor &&
								!transparentColor(st.backgroundColor);
							const focusVisible =
								!transparentOnFocus &&
								(hasOutline || boxShadowChanged || borderChanged || bgChanged);
							return {
								keyId,
								label,
								role,
								top: rect.top,
								left: rect.left,
								focusVisible,
								transparentOnFocus,
							};
						});
						if (!info || seen.has(info.keyId)) break;
						seen.add(info.keyId);
						focusSteps.push({
							label: info.label,
							role: info.role,
							top: info.top,
							left: info.left,
							focusVisible: info.focusVisible,
							transparentOnFocus: info.transparentOnFocus,
						});
					}
					const orderInversions: KeyboardObservation['orderInversions'] = [];
					for (let i = 1; i < focusSteps.length; i++) {
						const prev = focusSteps[i - 1];
						const curr = focusSteps[i];
						if (!prev || !curr) continue;
						const sameRow = Math.abs(curr.top - prev.top) <= 12;
						if (curr.top < prev.top - 12 || (sameRow && curr.left < prev.left - 12)) {
							orderInversions.push({ previous: prev.label, current: curr.label });
						}
					}
					return { focusSteps, orderInversions } satisfies KeyboardObservation;
				}
				await page.keyboard.press(key);
				return { pressed: key };
			}
			case 'type': {
				const text = typeof input?.text === 'string' ? input.text : '';
				await page.keyboard.type(text);
				return { typed: text.length };
			}
			case 'sr_read': {
				const nodes = await refreshAxNodes();
				const current = axCursor.nodes[axCursor.index] ?? null;
				// Analyze accessible tree strictly from AX nodes + live-region events
				const interactiveRoles = new Set([
					'checkbox',
					'button',
					'link',
					'radio',
					'menuitem',
					'switch',
					'textbox',
				]);
				const nameCounts = new Map<string, { role: string; name: string; count: number }>();
				let landmarks = 0;
				let headings = 0;
				for (const node of nodes) {
					if (node.role === 'heading') headings += 1;
					if (
						['main', 'navigation', 'banner', 'contentinfo', 'region', 'complementary'].includes(
							node.role
						)
					) {
						landmarks += 1;
					}
					if (interactiveRoles.has(node.role) && node.name) {
						const key = `${node.role}\0${node.name}`;
						const existing = nameCounts.get(key);
						if (existing) existing.count += 1;
						else nameCounts.set(key, { role: node.role, name: node.name, count: 1 });
					}
				}
				const duplicateControls = [...nameCounts.values()].filter((entry) => entry.count > 1);

				// Check for visible status/error text hidden from the accessibility tree via aria-hidden
				const ariaHiddenMessages = await page.evaluate(() => {
					const found: Array<{ text: string }> = [];
					const hiddenEls = Array.from(
						document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')
					);
					for (const el of hiddenEls) {
						const st = getComputedStyle(el);
						if (st.display === 'none' || st.visibility === 'hidden') continue;
						const rect = el.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) continue;
						const text = el.textContent?.trim() ?? '';
						if (text.length >= 4) {
							found.push({ text });
						}
					}
					return found;
				});

				// Probe whether activating a button causes a visible status update with NO live-region announcement
				const silentStatusUpdates: Array<{ changedText: string }> = [];
				await page.evaluate(() => {
					const win = window as unknown as {
						__srLiveAnnouncements?: string[];
						__srLiveInstalled?: boolean;
					};
					if (win.__srLiveInstalled) return;
					win.__srLiveInstalled = true;
					win.__srLiveAnnouncements = [];
					const observer = new MutationObserver((records) => {
						for (const rec of records) {
							const target =
								rec.target.nodeType === Node.ELEMENT_NODE
									? (rec.target as HTMLElement)
									: rec.target.parentElement;
							const liveAncestor = target?.closest('[aria-live], [role="status"], [role="alert"]');
							if (liveAncestor && liveAncestor.getAttribute('aria-live') !== 'off') {
								const txt = liveAncestor.textContent?.trim();
								if (txt) win.__srLiveAnnouncements?.push(txt);
							}
						}
					});
					observer.observe(document.body, {
						childList: true,
						subtree: true,
						characterData: true,
					});
				});

				// Trigger buttons via keyboard activation to observe live-region announcements
				const readRenderedLines = () =>
					page.evaluate(() => {
						const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
						const chunks: string[] = [];
						let node = walker.nextNode();
						while (node) {
							const parentTag = node.parentElement?.tagName;
							if (parentTag !== 'SCRIPT' && parentTag !== 'STYLE' && parentTag !== 'NOSCRIPT') {
								const txt = node.nodeValue?.trim();
								if (txt) chunks.push(txt);
							}
							node = walker.nextNode();
						}
						return chunks;
					});

				const buttonCount = await page.locator('button').count();
				for (let i = 0; i < Math.min(buttonCount, 5); i++) {
					const beforeLines = await readRenderedLines();
					const beforeLive = await page.evaluate(
						() =>
							(
								(window as unknown as { __srLiveAnnouncements?: string[] }).__srLiveAnnouncements ??
								[]
							).length
					);
					const btn = page.locator('button').nth(i);
					if (await btn.isVisible()) {
						await btn.focus();
						await page.keyboard.press('Enter');
						await page.waitForTimeout(30);
						const afterLines = await readRenderedLines();
						const afterLive = await page.evaluate(
							() =>
								(
									(window as unknown as { __srLiveAnnouncements?: string[] })
										.__srLiveAnnouncements ?? []
								).length
						);
						if (afterLive === beforeLive) {
							const beforeSet = new Set(beforeLines);
							const added = afterLines.filter((line) => !beforeSet.has(line));
							if (added.length > 0) {
								silentStatusUpdates.push({ changedText: added.join(' ') });
							}
						}
					}
				}

				const summary: ScreenReaderObservation = {
					duplicateControls,
					silentStatusUpdates,
					ariaHiddenMessages,
					landmarks,
					headings,
				};
				return { current, nodeCount: nodes.length, summary };
			}
			case 'sr_move': {
				if (axCursor.nodes.length === 0) await refreshAxNodes();
				const delta = input?.direction === 'prev' ? -1 : 1;
				axCursor.index = Math.max(
					0,
					Math.min(Math.max(0, axCursor.nodes.length - 1), axCursor.index + delta)
				);
				return { current: axCursor.nodes[axCursor.index] ?? null, index: axCursor.index };
			}
			case 'sr_jump': {
				const nodes = await refreshAxNodes();
				const role = typeof input?.role === 'string' ? input.role : 'heading';
				const targetIdx = nodes.findIndex((n, idx) => idx > axCursor.index && n.role === role);
				if (targetIdx >= 0) axCursor.index = targetIdx;
				return {
					current: targetIdx >= 0 ? (nodes[targetIdx] ?? null) : null,
					found: targetIdx >= 0,
				};
			}
			default:
				throw typedError(
					'MODALITY_FORBIDDEN',
					`Unsupported browser tool '${tool}'.`,
					'Use only tools permitted by the walk modality.'
				);
		}
	};
}

/**
 * Run a real Chromium modality-enforced walk strictly through the modality toolbox.
 * Never exposes raw HTML/CSS/DOM to the persona or fabricates fault markers.
 */
export async function runBrowserWalk(
	ctx: PanelWalkDriverContext,
	createToolbox: (
		executor: (tool: string, input?: Record<string, unknown>) => Promise<unknown>
	) => ModalityToolbox
): Promise<PanelWalkDriverResult> {
	assertWalkTargetAllowed(ctx.target, ctx.allowedOrigins);

	let browser: Browser | undefined;
	const onAbort = () => {
		void browser?.close().catch(() => {});
	};
	ctx.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const { chromium } = await import('playwright');
		browser = await chromium.launch({ headless: true });
		const context = await browser.newContext({
			viewport: { ...ctx.toolbox.viewport },
		});
		const page = await context.newPage();

		if (ctx.appDate) {
			const pinnedMs = Date.parse(`${ctx.appDate}T12:00:00.000Z`);
			await page.addInitScript((fixedStart: number) => {
				const RealDate = Date;
				const bootWall = RealDate.now();
				class PinnedDate extends RealDate {
					constructor(...args: unknown[]) {
						if (args.length === 0) {
							super(fixedStart + (RealDate.now() - bootWall));
						} else {
							super(...(args as [string | number]));
						}
					}
					static override now(): number {
						return fixedStart + (RealDate.now() - bootWall);
					}
				}
				Object.defineProperty(globalThis, 'Date', {
					value: PinnedDate,
					configurable: true,
					writable: true,
				});
			}, pinnedMs);
		}

		// Enforce origin allowlist on every request AND redirect
		await page.route('**/*', async (route) => {
			const reqUrl = route.request().url();
			try {
				assertWalkTargetAllowed(reqUrl, ctx.allowedOrigins);
				await route.continue();
			} catch {
				await route.abort('blockedbyclient');
			}
		});

		const response = await page.goto(ctx.target, {
			waitUntil: 'domcontentloaded',
			timeout: 15_000,
		});
		if (!response) {
			return {
				transcript: `Walk for ${ctx.job} (${ctx.modality})\nStopped — target failed to return a response.`,
				actions: 0,
				journal: [],
				findings: [
					{
						summary: `Target '${ctx.target}' produced no HTTP response.`,
						evidence: 'observed',
						where: ctx.target,
					},
				],
			};
		}
		if (response.status() >= 400) {
			return {
				transcript: `Walk for ${ctx.job} (${ctx.modality})\nStopped — target returned HTTP ${response.status()}.`,
				actions: 0,
				journal: [],
				findings: [
					{
						summary: `Target '${ctx.target}' returned HTTP ${response.status()}.`,
						evidence: 'observed',
						where: ctx.target,
					},
				],
			};
		}
		// Verify final URL after any same-origin navigation stayed allowed
		assertWalkTargetAllowed(page.url(), ctx.allowedOrigins);

		const cdp = await context.newCDPSession(page);
		const toolbox = createToolbox(createPlaywrightToolExecutor(page, cdp));
		const hasTool = (name: string) => toolbox.allowedTools.includes(name);

		const findings: WalkFinding[] = [];
		const stopReasons: string[] = [];

		if (ctx.modality === 'pointer') {
			if (hasTool('screenshot')) {
				await toolbox.invoke('screenshot');
			}
			if (hasTool('click')) {
				const clickRes = (await toolbox.invoke('click')) as ClickObservation;
				for (const target of clickRes.targets) {
					if (target.interceptedByCover) {
						findings.push({
							summary: `Pointer click on '${target.label}' was intercepted by an overlapping element.`,
							evidence: 'observed',
							where: `${ctx.job} (${target.label})`,
						});
						stopReasons.push(`an overlapping element blocked clicking '${target.label}'`);
					} else if (target.clippedOutsideContainer) {
						findings.push({
							summary: `Control '${target.label}' is clipped outside its container and unreachable by pointer click.`,
							evidence: 'observed',
							where: `${ctx.job} (${target.label})`,
						});
						stopReasons.push(`control '${target.label}' was clipped outside its container`);
					} else if (!target.respondedToClick && hasTool('double_click')) {
						const dbl = (await toolbox.invoke('double_click', {
							x: target.x,
							y: target.y,
						})) as { changed: boolean };
						if (dbl.changed) {
							findings.push({
								summary: `Control '${target.label}' ignored single click and only responded to double-click.`,
								evidence: 'observed',
								where: `${ctx.job} (${target.label})`,
							});
							stopReasons.push(`control '${target.label}' only responded to double-click`);
						}
					}
				}
			}
		} else if (ctx.modality === 'keyboard') {
			if (hasTool('screenshot')) {
				await toolbox.invoke('screenshot');
			}
			if (hasTool('press')) {
				const kb = (await toolbox.invoke('press', {
					key: 'Tab',
					probeFocusSequence: true,
				})) as KeyboardObservation;
				for (const step of kb.focusSteps) {
					if (step.transparentOnFocus) {
						findings.push({
							summary: `Focused control '${step.label}' became visually transparent on focus.`,
							evidence: 'observed',
							where: `${ctx.job} (${step.label})`,
						});
						stopReasons.push(`focused control '${step.label}' disappeared on focus`);
					} else if (!step.focusVisible) {
						findings.push({
							summary: `Focused control '${step.label}' showed no visible focus indicator.`,
							evidence: 'observed',
							where: `${ctx.job} (${step.label})`,
						});
						stopReasons.push(`focused control '${step.label}' had no visible focus ring`);
					}
				}
				for (const inv of kb.orderInversions) {
					findings.push({
						summary: `Keyboard tab order jumped visually backward from '${inv.previous}' to '${inv.current}'.`,
						evidence: 'observed',
						where: `${ctx.job} (focus order)`,
					});
					stopReasons.push(`tab order jumped backward from '${inv.previous}' to '${inv.current}'`);
				}
			}
		} else if (ctx.modality === 'low-vision') {
			if (hasTool('screenshot')) {
				const shot = (await toolbox.invoke('screenshot')) as { layout: ViewportObservation };
				const { layout } = shot;
				if (layout.horizontalOverflowPx > 4) {
					findings.push({
						summary: `Page overflows horizontally by ${layout.horizontalOverflowPx}px at ${layout.viewportWidth}px reflow width.`,
						evidence: 'observed',
						where: `${ctx.job} (viewport ${layout.viewportWidth}px)`,
					});
					stopReasons.push(`content overflowed horizontally at ${layout.viewportWidth}px`);
				}
				for (const clipped of layout.clippedControls) {
					findings.push({
						summary: `Control '${clipped.label}' is clipped at ${layout.viewportWidth}px (${clipped.reason}).`,
						evidence: 'observed',
						where: `${ctx.job} (${clipped.label})`,
					});
					stopReasons.push(`control '${clipped.label}' was clipped at ${layout.viewportWidth}px`);
				}
				for (const hidden of layout.hiddenMessagesAtNarrow) {
					findings.push({
						summary: `Message '${hidden.text}' is hidden at ${layout.viewportWidth}px (${hidden.reason}).`,
						evidence: 'observed',
						where: `${ctx.job} (viewport ${layout.viewportWidth}px)`,
					});
					stopReasons.push(`message '${hidden.text}' disappeared at ${layout.viewportWidth}px`);
				}
			}
			if (hasTool('scroll')) {
				await toolbox.invoke('scroll', { dy: 200 });
			}
		} else if (ctx.modality === 'screen-reader') {
			if (hasTool('sr_read')) {
				const sr = (await toolbox.invoke('sr_read')) as { summary: ScreenReaderObservation };
				for (const dup of sr.summary.duplicateControls) {
					findings.push({
						summary: `${dup.count} ${dup.role} controls share the identical accessible name '${dup.name}' with no distinguishing context.`,
						evidence: 'observed',
						where: `${ctx.job} (${dup.role} '${dup.name}')`,
					});
					stopReasons.push(`multiple ${dup.role} controls announced identically as '${dup.name}'`);
				}
				for (const silent of sr.summary.silentStatusUpdates) {
					findings.push({
						summary: `Visible status update '${silent.changedText}' was never announced through a live region.`,
						evidence: 'observed',
						where: `${ctx.job} (live region)`,
					});
					stopReasons.push('status update occurred without a live-region announcement');
				}
				for (const hidden of sr.summary.ariaHiddenMessages) {
					findings.push({
						summary: `Visible message '${hidden.text}' is marked aria-hidden="true" and omitted from screen-reader output.`,
						evidence: 'observed',
						where: `${ctx.job} (accessibility tree)`,
					});
					stopReasons.push(`visible message '${hidden.text}' was hidden from the screen reader`);
				}
			}
		}

		// Read optional journal exposed by the target application (if any) without reading DOM/CSS
		const appJournal = await page.evaluate((): WalkJournalEntry[] => {
			const raw = (window as unknown as { __afdJournal?: WalkJournalEntry[] }).__afdJournal;
			return Array.isArray(raw) ? raw : [];
		});

		const blocked = stopReasons.length > 0;
		const lines = [
			`Walk for ${ctx.job} (${ctx.modality})`,
			...findings.map((f) => `- [${f.evidence}] ${f.summary}`),
			blocked ? `Stopped — ${stopReasons[0]}.` : 'Done.',
		];

		return {
			transcript: lines.join('\n'),
			actions: toolbox.calls.length,
			journal: appJournal,
			findings,
		};
	} finally {
		ctx.signal?.removeEventListener('abort', onAbort);
		if (browser) {
			await browser.close().catch(() => {});
		}
	}
}
