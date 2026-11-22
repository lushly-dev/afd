/**
 * `mailfix` over stdio (phase 5 specification, Jobs and scenarios, `p5-base`), so the desktop suite can mount it as
 * a `stdio` instance: `command = [<node>, "<this file>"]`. Run by Node, which strips its types, as the desktop's
 * `test/fixtures/notify-server.ts` is; hence the `.ts` import. Each process holds fresh state. Logs go to stderr,
 * since stdout carries the JSON-RPC stream.
 *
 * Its one peer is the process that started it, Loam's Rust host, so that peer is its approver (AFD's carrier; Loam's
 * 7.2): a stdio connection carries no credential, which is the operating-system user's boundary, as for mail's
 * engine's `cli.token` (T15). `LOAM_MAILFIX_APPROVER=0` starts it with none, for a test of an instance Loam cannot
 * release.
 */
import { createMailfixServer } from './mailfix.ts';

const approver = process.env.LOAM_MAILFIX_APPROVER === '0' ? undefined : () => true;
await createMailfixServer({ transport: 'stdio', ...(approver ? { approver } : {}) }).start();
