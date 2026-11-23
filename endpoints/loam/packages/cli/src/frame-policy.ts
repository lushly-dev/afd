/**
 * @fileoverview `@lushly-dev/loam-cli/frame-policy`: the copilot frame's header policy (phase 5 specification,
 * 3.2), which any server of the built shell sends on the sandbox origin: the hosted server (`loam-host`), and the
 * Chromium suite's own server, which stands for a deployer's. Beside `deployment`, which writes the shell's own
 * policy; a subpath with no imports, so a server reads it without the kernel or the frame's code (a `local`
 * deployment of `loam-host` loads no kernel, `host/src/mcp.test.ts`), and local code never reaches into the hosted
 * lane for it (D162).
 */

/** The copilot runtime's frame and its chunks, on the sandbox origin (phase 5 specification, 3.2). */
export const COPILOT_FRAME_PATH = '/sandbox/copilot/';

/** Whether a request's path on the sandbox origin is under the copilot's path, which carries its own policy. */
export function isCopilotFramePath(path: string): boolean {
	return path.startsWith(COPILOT_FRAME_PATH);
}

/**
 * The copilot frame's header policy (phase 5 specification, 3.2), on every file under its path: scripts only from
 * that path on the sandbox origin, never `'self'`, which matches nothing in an opaque-origin document on WebKitGTK
 * 2.52; workers only from `blob:`, which inherit it; no connection of its own; framed only by the shell. The path,
 * not the whole origin, since the sandbox origin also serves the sandbox proxy and app views.
 */
export function copilotFramePolicy(sandboxOrigin: string, shellOrigin: string): string {
	const path = new URL(COPILOT_FRAME_PATH, sandboxOrigin).href;
	return `default-src 'none'; script-src ${path}; worker-src blob:; connect-src 'none'; frame-ancestors ${shellOrigin}`;
}
