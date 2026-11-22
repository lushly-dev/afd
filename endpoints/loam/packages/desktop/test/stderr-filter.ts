/**
 * Stderr filter for Loam's desktop test harnesses (#1448): keeps Tauri's `__TAURI_INVOKE_KEY__`
 * refusal lines redacted before anything reaches captured lines or CI logs, while counting every
 * refusal so frame-isolation suites can assert whether a forged message reached the host.
 */
import type { Readable } from 'node:stream';

/** Tauri 2.12's line when it drops a message for its invoke key (`Webview::on_message`). */
export const INVOKE_KEY_LINE =
	/__TAURI_INVOKE_KEY__ expected (\S+) but received ((?:(?!__TAURI_INVOKE_KEY__ expected \S+ but received )[^\n])*)/;
const INVOKE_KEY_LINE_GLOBAL = new RegExp(INVOKE_KEY_LINE.source, 'g');

/** A line of the app's stderr with every Tauri invoke-key refusal redacted so neither key reaches logs. */
export function redactInvokeKey(line: string): string {
	return line.replace(
		INVOKE_KEY_LINE_GLOBAL,
		(match, _expected: string, received: string, offset: number, full: string) => {
			const nextAt = offset + match.length;
			const sep = nextAt < full.length && full[nextAt] !== '\n' && /\s$/.test(received) ? ' ' : '';
			const value = sep ? received.slice(0, -1) : received;
			return `__TAURI_INVOKE_KEY__ expected <key> but received ${value === '' ? '<empty>' : '<other>'}${sep}`;
		}
	);
}

/**
 * Pipes a child process's stderr line by line through `redactInvokeKey`, counting invoke-key refusals,
 * storing each redacted line, and forwarding it to `write` (default `process.stderr.write`). Flushes a
 * trailing line without a newline when the stream ends so no key can slip past on partial output.
 */
export function pipeRedactedStderr(
	stream: Readable | null | undefined,
	target: { lines: string[]; keyRefusals: number },
	write: (text: string) => unknown = (text) => process.stderr.write(text)
): void {
	if (!stream) return;
	const record = (line: string) => {
		const matches = line.match(INVOKE_KEY_LINE_GLOBAL);
		if (matches) target.keyRefusals += matches.length;
		const shown = redactInvokeKey(line);
		target.lines.push(shown);
		write(`${shown}\n`);
	};
	let partial = '';
	stream.setEncoding('utf8');
	stream.on('data', (chunk: string) => {
		const lines = (partial + chunk).split(/\r?\n/);
		partial = lines.pop() ?? '';
		for (const line of lines) record(line);
	});
	stream.on('end', () => {
		if (partial) {
			record(partial);
			partial = '';
		}
	});
}
