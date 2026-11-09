/**
 * @fileoverview Checklist's definition: its handlers and nothing else, since a view's editor is a page of its
 * own (documents specification, 10.1). The handlers' frame serves it, and the test kit runs it with no frame.
 */

import { defineApp } from '@lushly-dev/loam-sdk';
import { handlers } from './handlers.js';

export default defineApp({ sdk: 1, handlers });
