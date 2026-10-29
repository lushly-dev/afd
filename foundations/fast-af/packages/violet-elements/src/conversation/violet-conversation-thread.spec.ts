import { Observable } from "@lushly-dev/fast-element";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./violet-conversation-thread";
import type { VioletConversationThread } from "./violet-conversation-thread";

// The Vitest browser transform drops decorators on `declare` fields, so `@observable` properties are plain
// fields there. Install the accessors the decorator adds in the production (tsc) build so reactive
// bindings behave the same way under test. This is a no-op once the transform applies decorators.
function ensureObservables(tagName: string, names: string[]): void {
    const prototype = customElements.get(tagName)?.prototype;
    for (const name of names) {
        if (prototype && !Object.getOwnPropertyDescriptor(prototype, name)?.get) {
            Observable.defineProperty(prototype, name);
        }
    }
}

ensureObservables("violet-conversation-thread", ["isOverflowing", "userScrolledAway"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

function messages(count: number, height = 60): string {
    return Array.from({ length: count }, (_value, index) => `<div class="msg" style="block-size:${height}px">Message ${index + 1}</div>`).join("");
}

// The component scrolls smoothly; animations make positions non-deterministic, so tests jump instantly
// unless they opt in with `smooth`.
const instantScroll = "violet-conversation-thread::part(scroll-region) { scroll-behavior: auto; }";

function setSmoothScrolling(enabled: boolean): void {
    document.getElementById("instant-scroll")?.remove();
    if (!enabled) {
        const style = document.createElement("style");
        style.id = "instant-scroll";
        style.textContent = instantScroll;
        document.head.append(style);
    }
}

async function renderThread(attrs = "", content = messages(2), height = 200): Promise<VioletConversationThread> {
    document.body.innerHTML = `<violet-conversation-thread ${attrs} style="block-size:${height}px;display:flex">${content}</violet-conversation-thread>`;
    await customElements.whenDefined("violet-conversation-thread");
    await settle();
    return document.querySelector("violet-conversation-thread") as VioletConversationThread;
}

function regionOf(thread: VioletConversationThread): HTMLElement {
    const region = thread.shadowRoot?.querySelector<HTMLElement>('[part="scroll-region"]');
    if (!region) {
        throw new Error("Expected the scroll region to render.");
    }
    return region;
}

function emptyOf(thread: VioletConversationThread): HTMLElement {
    const empty = thread.shadowRoot?.querySelector<HTMLElement>('[part="empty"]');
    if (!empty) {
        throw new Error("Expected the empty container to render.");
    }
    return empty;
}

describe("violet-conversation-thread", () => {
    beforeEach(() => {
        setSmoothScrolling(false);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.getElementById("instant-scroll")?.remove();
    });

    describe("attributes and semantics", () => {
        it("defaults to idle and not empty", async () => {
            const thread = await renderThread();

            expect(thread.busy).toBe(false);
            expect(thread.empty).toBe(false);
        });

        it("exposes the scroll region as a focusable log", async () => {
            const thread = await renderThread();
            const region = regionOf(thread);

            expect(region.getAttribute("role")).toBe("log");
            expect(region.getAttribute("tabindex")).toBe("0");
        });

        it("uses a polite live region while idle", async () => {
            const thread = await renderThread();
            const region = regionOf(thread);

            expect(region.getAttribute("aria-live")).toBe("polite");
            expect(region.getAttribute("aria-busy")).toBe("false");
        });

        it("silences the live region and marks it busy while busy", async () => {
            const thread = await renderThread("busy");
            const region = regionOf(thread);

            expect(thread.busy).toBe(true);
            expect(region.getAttribute("aria-live")).toBe("off");
            expect(region.getAttribute("aria-busy")).toBe("true");
        });

        it("reflects busy and empty properties to attributes and updates semantics", async () => {
            const thread = await renderThread();

            thread.busy = true;
            thread.empty = true;
            await settle();
            expect(thread.getAttribute("busy")).toBe("");
            expect(thread.getAttribute("empty")).toBe("");
            expect(regionOf(thread).getAttribute("aria-live")).toBe("off");

            thread.busy = false;
            await settle();
            expect(thread.hasAttribute("busy")).toBe(false);
            expect(regionOf(thread).getAttribute("aria-live")).toBe("polite");
            expect(regionOf(thread).getAttribute("aria-busy")).toBe("false");
        });
    });

    describe("empty state", () => {
        it("hides the empty container and shows the scroll region when populated", async () => {
            const thread = await renderThread();

            expect(emptyOf(thread).hidden).toBe(true);
            expect(regionOf(thread).hidden).toBe(false);
        });

        it("shows the empty slot and hides the scroll region when empty", async () => {
            const thread = await renderThread("empty", '<p slot="empty">Ask me anything</p>');
            const slot = emptyOf(thread).querySelector<HTMLSlotElement>('slot[name="empty"]');

            expect(emptyOf(thread).hidden).toBe(false);
            expect(regionOf(thread).hidden).toBe(true);
            expect(slot?.assignedElements()[0]?.textContent).toBe("Ask me anything");
        });

        it("toggles between empty and populated views as the attribute changes", async () => {
            const thread = await renderThread("empty");

            thread.removeAttribute("empty");
            await settle();
            expect(emptyOf(thread).hidden).toBe(true);
            expect(regionOf(thread).hidden).toBe(false);

            thread.setAttribute("empty", "");
            await settle();
            expect(emptyOf(thread).hidden).toBe(false);
            expect(regionOf(thread).hidden).toBe(true);
        });
    });

    describe("slots", () => {
        it("projects messages into the content part inside the scroll region", async () => {
            const thread = await renderThread("", messages(3));
            const slot = regionOf(thread).querySelector<HTMLSlotElement>('[part="content"] slot');

            expect(slot?.assignedElements()).toHaveLength(3);
            expect(slot?.assignedElements()[0]?.textContent).toBe("Message 1");
        });
    });

    describe("scrolling", () => {
        it("scrolls to the bottom on connection when content overflows", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);

            expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
            expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(1);
        });

        it("reports overflow when content exceeds the viewport", async () => {
            const overflowing = await renderThread("", messages(10));
            expect(overflowing.isOverflowing).toBe(true);

            const short = await renderThread("", messages(1));
            expect(short.isOverflowing).toBe(false);
        });

        it("follows new messages while the user is at the bottom", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);
            const message = document.createElement("div");
            message.style.blockSize = "120px";
            message.textContent = "New message";

            thread.append(message);
            await settle();

            expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(1);
        });

        it("flags userScrolledAway once the user scrolls far from the bottom", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);

            region.scrollTop = 0;
            await settle();

            expect(thread.userScrolledAway).toBe(true);
        });

        it("does not flag userScrolledAway within 50px of the bottom", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);

            region.scrollTop = region.scrollHeight - region.clientHeight - 20;
            await settle();

            expect(thread.userScrolledAway).toBe(false);
        });

        it("does not yank the user back down when new messages arrive after they scrolled away", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);
            region.scrollTop = 0;
            await settle();
            expect(thread.userScrolledAway).toBe(true);

            const message = document.createElement("div");
            message.style.blockSize = "120px";
            thread.append(message);
            await settle();

            expect(region.scrollTop).toBe(0);
        });

        it("scrollToBottom() jumps to the end and clears userScrolledAway", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);
            region.scrollTop = 0;
            await settle();
            expect(thread.userScrolledAway).toBe(true);

            thread.scrollToBottom();
            await settle();

            expect(thread.userScrolledAway).toBe(false);
            expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(1);
        });

        it("resumes auto-following after scrollToBottom()", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);
            region.scrollTop = 0;
            await settle();

            thread.scrollToBottom();
            await settle();
            const message = document.createElement("div");
            message.style.blockSize = "120px";
            thread.append(message);
            await settle();

            expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(1);
        });
    });

    it("does not mistake its own smooth scroll for the user scrolling away", async () => {
        setSmoothScrolling(true);
        const thread = await renderThread("", messages(30));
        thread.scrollToBottom();
        await nextFrame();
        await nextFrame();

        expect(thread.userScrolledAway).toBe(false);
    });

    describe("lifecycle", () => {
        it("stops observing content after disconnection", async () => {
            const thread = await renderThread("", messages(10));
            const region = regionOf(thread);
            region.scrollTop = 0;
            await settle();

            thread.remove();
            const message = document.createElement("div");
            message.textContent = "orphan";
            thread.append(message);
            await settle();

            expect(region.scrollTop).toBe(0);
        });

        it("can be reconnected and keeps scrolling to new content", async () => {
            const thread = await renderThread("", messages(10));
            const parent = thread.parentElement as HTMLElement;

            thread.remove();
            parent.append(thread);
            await settle();
            const region = regionOf(thread);
            const message = document.createElement("div");
            message.style.blockSize = "120px";
            thread.append(message);
            await settle();

            expect(region.scrollHeight - region.scrollTop - region.clientHeight).toBeLessThanOrEqual(1);
        });
    });
});
