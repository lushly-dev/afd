/** @fileoverview The FAST-AF page in Chromium: the shared suite on this package's `dist`. */
import { describePage } from '@afd/example-todo-ui/page-suite';

describePage('the FAST-AF page', new URL('../dist/', import.meta.url));
