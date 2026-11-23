import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPILOT_FRAME_PATH, copilotFramePolicy, isCopilotFramePath } from './frame-policy.js';

describe("the copilot frame's header policy (phase 5 specification, 3.2)", () => {
	it("P5-A2: the copilot frame's policy names its path on the sandbox origin, never 'self', and is framed only by the shell (phase 5's 3.2)", () => {
		expect(COPILOT_FRAME_PATH).toBe('/sandbox/copilot/');
		expect(copilotFramePolicy('https://127.0.0.1:8444', 'https://localhost:8443')).toBe(
			"default-src 'none'; script-src https://127.0.0.1:8444/sandbox/copilot/; worker-src blob:; connect-src 'none'; frame-ancestors https://localhost:8443"
		);
		// The desktop's scheme, whose origin a URL reads as opaque, still gives its path.
		expect(copilotFramePolicy('loam-sandbox://localhost', 'loam://localhost')).toBe(
			"default-src 'none'; script-src loam-sandbox://localhost/sandbox/copilot/; worker-src blob:; connect-src 'none'; frame-ancestors loam://localhost"
		);
		expect(
			copilotFramePolicy('https://sandbox.example.net', 'https://loam.example.com')
		).not.toContain("'self'");
		for (const path of ['/sandbox/copilot/index.html', '/sandbox/copilot/runtime-anthropic.js'])
			expect(isCopilotFramePath(path), path).toBe(true);
		for (const path of [
			'/sandbox/proxy.html',
			'/sandbox/copilot',
			'/sandbox/copilot-other.html',
			'/copilot/',
		])
			expect(isCopilotFramePath(path), path).toBe(false);
	});

	it("imports nothing, so a server reads it without the kernel or the frame (`loam-host`'s `local` deployment loads no kernel)", () => {
		const source = readFileSync(new URL('./frame-policy.ts', import.meta.url), 'utf8');
		expect(source).toMatch(/export function copilotFramePolicy/);
		expect(source.match(/^\s*(?:import|export)\b[^;]*\bfrom\s*['"]|\bimport\s*\(/gm) ?? []).toEqual(
			[]
		);
	});
});
