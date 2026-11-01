/**
 * The browser host's entry. Step 7 of the phase 0 specification wires the kernel and the chrome
 * here; until then it only marks the document as booted, which the Chromium smoke test reads.
 */
document.documentElement.dataset.loamHost = 'web';
