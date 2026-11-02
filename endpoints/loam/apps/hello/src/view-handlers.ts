/**
 * @fileoverview Hello's handlers in their hidden frame (phase 1 specification, 6.3): the module the native
 * kind runs, with nothing added, compiled into `dist/handlers.html`.
 */

import { defineApp } from '@lushly-dev/loam-sdk';
import { serveHandlers } from '@lushly-dev/loam-sdk/view';
import { handlers } from './handlers.js';

serveHandlers(defineApp({ sdk: 1, handlers }));
