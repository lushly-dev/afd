/**
 * @fileoverview Checklist's handlers in their hidden frame on the sandbox origin (phase 1 specification, 6.3),
 * compiled into `dist/handlers.html`: the same definition the test kit runs, with nothing added.
 */

import { serveHandlers } from '@lushly-dev/loam-sdk/view';
import app from './app.js';

serveHandlers(app);
