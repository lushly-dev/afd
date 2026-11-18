/** The runtime chunk for `anthropic`, and for `test`, whose scripted provider answers in Anthropic's format. */
import { anthropicAdapter } from './adapter-anthropic.js';
import { serveWorker } from './worker.js';

serveWorker(anthropicAdapter);
