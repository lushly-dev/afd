/**
 * Zod compiles object parsers with `new Function` unless told not to, and its probe for that is a
 * CSP violation under `script-src 'self'` (phase 0 specification, section 9) even though the
 * probe catches the error. Modules may parse while they load, so the entry imports this module
 * before any other; the interpreter gives the same results.
 */

import { config } from 'zod';

config({ jitless: true });
