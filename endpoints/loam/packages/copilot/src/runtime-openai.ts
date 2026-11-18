/** The runtime chunk for `openai` and `openai-compatible`. */
import { openaiAdapter } from './adapter-openai.js';
import { serveWorker } from './worker.js';

serveWorker(openaiAdapter);
