/**
 * `mailfix` over stdio (phase 5 specification, Jobs and scenarios, `p5-base`), so the desktop suite can mount it as
 * a `stdio` instance: `command = [<node>, "<this file>"]`. Run by Node, which strips its types, as the desktop's
 * `test/fixtures/notify-server.ts` is; hence the `.ts` import. Each process holds fresh state. Logs go to stderr,
 * since stdout carries the JSON-RPC stream.
 */
import { createMailfixServer } from './mailfix.ts';

await createMailfixServer({ transport: 'stdio' }).start();
