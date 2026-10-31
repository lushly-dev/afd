import { resolve } from 'node:path';
import { type Browser, type BrowserServer, chromium, type Page } from 'playwright';
import type { SpecimenBench } from './bench.js';
import { BROWSER_LAUNCH_TIMEOUT } from './bench-worker-client.js';
import { digest, type LoadedConfig, loadConfig, resolveContext } from './config.js';
import { normalizeDom } from './normalize.js';
import { dependencyIdentity, sourceState } from './provenance.js';
import { captureRequestSchema } from './schema.js';
import {
	type BenchOptions,
	CAPTURE_VERSION,
	type Completeness,
	NORMALIZATION_VERSION,
	type Observation,
	type ScenarioStep,
	type Target,
} from './types.js';
import { startBenchServer } from './vite.js';

function coverage(
	status: Completeness['status'],
	scope: string,
	reasons: string[] = []
): Completeness {
	return { status, scope, reasons };
}
function targetLocator(page: Page, target: Target | undefined) {
	if (!target) throw new Error('Scenario action refers to an undeclared target');
	return 'selector' in target
		? page.locator('#specimen-root').locator(target.selector)
		: page.locator('#specimen-root').getByRole(target.role as Parameters<Page['getByRole']>[0], {
				name: target.name,
				exact: true,
			});
}
async function performSteps(
	page: Page,
	targets: Record<string, Target>,
	steps: ScenarioStep[],
	checkpoint: string
): Promise<void> {
	if (checkpoint === 'mount') return;
	if (
		checkpoint !== 'after-run' &&
		!steps.some((step) => 'capture' in step && step.capture === checkpoint)
	)
		throw new Error(`Checkpoint not found: ${checkpoint}`);
	for (const step of steps) {
		if ('capture' in step) {
			if (step.capture === checkpoint) return;
			continue;
		}
		const action = step.action;
		const name =
			'click' in action
				? action.click
				: 'focus' in action
					? action.focus
					: 'hover' in action
						? action.hover
						: action.fill;
		const locator = targetLocator(page, targets[name]);
		if ((await locator.count()) !== 1)
			throw new Error(`Target must identify exactly one element: ${name}`);
		if ('click' in action) await locator.click();
		else if ('focus' in action) await locator.focus();
		else if ('hover' in action) await locator.hover();
		else await locator.fill(action.value);
		// Include callbacks already queued for the next frame and their microtasks.
		// This is a bounded checkpoint, not arbitrary async or animation settlement.
		await page.evaluate(
			() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
		);
	}
}
async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Specimen deadline exceeded after ${milliseconds}ms`)),
					milliseconds
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
/** Heavy runtime, imported only after the first accepted render or build. */
export async function createInProcessBench(
	options: BenchOptions,
	validatedConfig?: LoadedConfig,
	runtimeOptions: { ownedProcess?: boolean } = {}
): Promise<SpecimenBench> {
	const config = validatedConfig ?? (await loadConfig(options));
	const server = await startBenchServer(config, { automation: true });
	let browser: Promise<Browser> | undefined;
	let browserServer: Promise<BrowserServer> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;
	const ensureOpen = () => {
		if (closed) throw new Error('Specimen bench is closed');
	};
	return {
		list() {
			ensureOpen();
			return config.config.specimens.map((entry) => ({ ...entry }));
		},
		async build(outDir) {
			ensureOpen();
			return server.build(outDir);
		},
		async render(rawRequest) {
			ensureOpen();
			const parsed = captureRequestSchema.parse(rawRequest);
			const request = {
				...parsed,
				checkpoint: parsed.checkpoint ?? 'mount',
				timeoutMs: parsed.timeoutMs ?? 10_000,
			};
			const entry = config.config.specimens.find((item) => item.id === request.id);
			if (!entry) throw new Error(`Specimen not found: ${request.id}`);
			const context = resolveContext(request.context);
			if (!browser) {
				if (runtimeOptions.ownedProcess) {
					// Only an owned worker may use an exit watchdog during browser startup.
					// Keep a public force-kill handle once the browser is ready.
					browserServer = chromium.launchServer({
						host: '127.0.0.1',
						port: 0,
						headless: true,
						executablePath: options.executablePath,
						timeout: BROWSER_LAUNCH_TIMEOUT,
						handleSIGTERM: false,
						handleSIGINT: false,
						handleSIGHUP: false,
					});
					browser = browserServer.then((host) =>
						chromium.connect(host.wsEndpoint(), { timeout: BROWSER_LAUNCH_TIMEOUT })
					);
				} else {
					browser = chromium.launch({
						headless: true,
						executablePath: options.executablePath,
						timeout: BROWSER_LAUNCH_TIMEOUT,
					});
				}
			}

			const instance = await browser;
			const browserContext = await instance.newContext({
				viewport: context.viewport,
				locale: context.locale,
				colorScheme: context.theme,
				reducedMotion: context.reducedMotion,
				deviceScaleFactor: 1,
			});
			const page = await browserContext.newPage();
			page.setDefaultTimeout(request.timeoutMs);
			const messages = { errors: [] as string[], warnings: [] as string[] };
			page.on('console', (message) => {
				if (message.type() === 'error') messages.errors.push(message.text());
				if (message.type() === 'warning') messages.warnings.push(message.text());
			});
			page.on('pageerror', (error) => messages.errors.push(error.message));
			const resources: Promise<string>[] = [];
			page.on('response', (response) => {
				// Streaming application traffic must not hold source provenance open.
				if (!['document', 'script', 'stylesheet'].includes(response.request().resourceType()))
					return;
				resources.push(
					response
						.body()
						.then((body) => `${new URL(response.url()).pathname}:${digest(body)}`)
						.catch(() => `${new URL(response.url()).pathname}:unavailable`)
				);
			});
			let runtimeReady = false;
			let disposed = false;
			try {
				const observation = await deadline(
					(async (): Promise<Observation> => {
						await page.mouse.move(-1, -1);
						const response = await page.goto(`${server.url}/specimen.html?automation=1`);
						if (!response?.ok())
							throw new Error(`Bench page returned HTTP ${response?.status() ?? 'unknown'}`);
						await page.waitForFunction(() => Boolean(window.__specimen));
						runtimeReady = true;
						const mounted = await page.evaluate(
							({ entry: item, context: resolved }) => window.__specimen.mount(item, resolved),
							{ entry, context }
						);
						await performSteps(page, mounted.targets, mounted.scenario, request.checkpoint);
						const captured = await page.evaluate(() => window.__specimen.capture());
						const snapshot = await page.locator('#specimen-root').ariaSnapshot();
						const screenshot = request.screenshot ? resolve(config.root, request.screenshot) : null;
						if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
						const [source, dependencies, loadedResources] = await Promise.all([
							sourceState(config.root),
							dependencyIdentity(config.root),
							Promise.all(resources),
						]);
						const limitations = captured.limitations;
						const unstable = limitations.filter((value) => value.includes('time-dependent'));
						// Layout and styles observed under a context other than the manifest's are not evidence for it.
						const contextual = [
							...unstable,
							...limitations.filter((value) => value.startsWith('Context mismatch')),
						];
						return {
							manifest: {
								captureVersion: CAPTURE_VERSION,
								normalizationVersion: NORMALIZATION_VERSION,
								specimenId: entry.id,
								checkpoint: request.checkpoint,
								source: {
									...source,
									digest: digest([config.digest, ...loadedResources.sort()].join('\n')),
								},
								dependencies,
								browser: { name: 'chromium', version: instance.version() },
								context,
							},
							channels: {
								dom: { raw: captured.dom, normalized: normalizeDom(captured.dom) },
								a11y: { snapshot, axe: 'not-run' },
								elements: captured.elements,
								console: messages,
								visual: { path: screenshot },
							},
							completeness: {
								dom: coverage(
									limitations.some((value) => value.toLowerCase().includes('closed'))
										? 'partial'
										: 'complete',
									'light DOM and accessible open shadow roots',
									limitations.filter((value) => value.toLowerCase().includes('closed'))
								),
								a11y: coverage('partial', 'ARIA snapshot; axe not run', ['AXE_NOT_RUN']),
								layout: coverage(
									contextual.length ? 'partial' : 'complete',
									'boxes and scroll extents of accessible elements; pseudo-element geometry excluded',
									contextual
								),
								styles: coverage(
									contextual.length ? 'partial' : 'complete',
									'versioned selected computed CSS properties on accessible elements',
									contextual
								),
								tokens: coverage('unsupported', 'token dependencies', [
									'TOKEN_DETECTOR_NOT_IMPLEMENTED',
								]),
								events: coverage('unsupported', 'declared event history', [
									'EVENT_CAPTURE_NOT_IMPLEMENTED',
								]),
								visual: coverage(screenshot ? 'partial' : 'not-requested', 'appearance', [
									...limitations,
									...(screenshot
										? ['PIXEL_COMPARISON_NOT_IMPLEMENTED']
										: ['SCREENSHOT_NOT_REQUESTED']),
								]),
							},
						};
					})(),
					request.timeoutMs
				);
				await deadline(
					page.evaluate(() => window.__specimen.dispose()),
					Math.min(request.timeoutMs, 1000)
				);
				disposed = true;
				return observation;
			} catch (error) {
				try {
					if (runtimeReady && !disposed)
						await deadline(
							page.evaluate(() => window.__specimen.dispose()),
							Math.min(request.timeoutMs, 1000)
						);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						`Specimen render and disposal failed: ${String(error)}; ${String(cleanupError)}`
					);
				}
				throw error;
			} finally {
				await browserContext.close();
			}
		},
		close() {
			closing ??= (async () => {
				closed = true;
				try {
					const host = await browserServer?.catch(() => undefined);
					if (host) {
						try {
							await deadline(host.close(), 500);
						} catch {
							// Public Playwright API kills and reaps the owned process group.
							await host.kill();
						}
					} else {
						await (await browser?.catch(() => undefined))?.close();
					}
				} finally {
					browser = undefined;
					browserServer = undefined;
					await server.close();
				}
			})();
			return closing;
		},
	};
}
