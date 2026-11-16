/** @fileoverview The to-do page's shared Chromium suite, on this page's build: the list works as on the FAST-AF page. */
import { describePage } from '@afd/example-todo-ui/page-suite';

describePage('the copilot page', new URL('../dist/', import.meta.url));
