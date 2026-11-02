/**
 * Zod compiles object parsers with `new Function` unless told not to, and its probe for that is a
 * CSP violation under `script-src 'self'` (phase 0 specification, section 9) even though the
 * probe catches the error. Modules may parse while they load, so a page imports this module before
 * any other; the interpreter gives the same results. The shell's own build does not use it: it splits
 * code, a shared chunk runs before the entry, and `zodJitlessByDefault` in `scripts/narrow-zod.mjs`
 * holds in every chunk. This is for a page built as one chunk, such as the accelerator page.
 */

import { config } from 'zod';

config({ jitless: true });
