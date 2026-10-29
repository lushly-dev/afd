import { Observable } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it } from "vitest";

import "./violet-message";
import type { VioletMessage } from "./violet-message";

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

ensureObservables("violet-message", ["hasAvatar", "hasMeta"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

async function renderMessage(attrs = "", content = "Hello"): Promise<VioletMessage> {
    document.body.innerHTML = `<violet-message ${attrs}>${content}</violet-message>`;
    await customElements.whenDefined("violet-message");
    await settle();
    return document.querySelector("violet-message") as VioletMessage;
}

function partOf(message: VioletMessage, part: string): HTMLElement {
    const element = message.shadowRoot?.querySelector<HTMLElement>(`[part="${part}"]`);
    if (!element) {
        throw new Error(`Expected part "${part}" to render.`);
    }
    return element;
}

describe("violet-message", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and properties", () => {
        it("defaults to a default-tone, non-streaming assistant message", async () => {
            const message = await renderMessage();

            expect(message.messageRole).toBe("assistant");
            expect(message.tone).toBe("default");
            expect(message.streaming).toBe(false);
        });

        it("maps message-role, tone and streaming attributes to properties", async () => {
            const message = await renderMessage('message-role="user" tone="error" streaming');

            expect(message.messageRole).toBe("user");
            expect(message.tone).toBe("error");
            expect(message.streaming).toBe(true);
        });

        it("reflects properties back to attributes", async () => {
            const message = await renderMessage();

            message.messageRole = "system";
            message.tone = "muted";
            message.streaming = true;
            await settle();

            expect(message.getAttribute("message-role")).toBe("system");
            expect(message.getAttribute("tone")).toBe("muted");
            expect(message.getAttribute("streaming")).toBe("");

            message.streaming = false;
            await settle();
            expect(message.hasAttribute("streaming")).toBe(false);
        });
    });

    describe("semantics", () => {
        it("renders an article whose label names the role", async () => {
            const message = await renderMessage('message-role="user"');
            const article = partOf(message, "root");

            expect(article.tagName).toBe("ARTICLE");
            expect(article.getAttribute("aria-label")).toBe("user message");
        });

        it("updates the label when the role changes", async () => {
            const message = await renderMessage('message-role="user"');

            message.messageRole = "system";
            await settle();

            expect(partOf(message, "root").getAttribute("aria-label")).toBe("system message");
        });

        it("does not mark an idle message busy", async () => {
            const message = await renderMessage();

            expect(partOf(message, "root").hasAttribute("aria-busy")).toBe(false);
        });

        it("exposes aria-busy=true while streaming", async () => {
            const message = await renderMessage("streaming");

            expect(partOf(message, "root").getAttribute("aria-busy")).toBe("true");
        });
    });

    describe("slots", () => {
        it("projects default-slot content into the body part", async () => {
            const message = await renderMessage("", "<p>Reply text</p>");
            const slot = partOf(message, "body").querySelector<HTMLSlotElement>("slot:not([name])");

            expect(slot?.assignedElements()[0]?.textContent).toBe("Reply text");
        });

        it("hides the avatar wrapper and meta row when those slots are empty", async () => {
            const message = await renderMessage();

            expect(message.hasAvatar).toBe(false);
            expect(message.hasMeta).toBe(false);
            expect(partOf(message, "avatar").hidden).toBe(true);
            expect(partOf(message, "meta").hidden).toBe(true);
        });

        it("shows the avatar wrapper when an avatar is slotted", async () => {
            const message = await renderMessage("", '<span slot="avatar">A</span>Hello');
            const slot = partOf(message, "avatar").querySelector<HTMLSlotElement>("slot");

            expect(message.hasAvatar).toBe(true);
            expect(partOf(message, "avatar").hidden).toBe(false);
            expect(slot?.assignedElements()[0]?.textContent).toBe("A");
        });

        it("shows the meta row when meta content is slotted", async () => {
            const message = await renderMessage("", '<time slot="meta">12:00</time>Hello');
            const slot = partOf(message, "meta").querySelector<HTMLSlotElement>("slot");

            expect(message.hasMeta).toBe(true);
            expect(partOf(message, "meta").hidden).toBe(false);
            expect(slot?.assignedElements()[0]?.textContent).toBe("12:00");
        });

        it("ignores whitespace-only text in avatar and meta slots", async () => {
            const message = await renderMessage("", "Hello");

            message.handleAvatarSlotChange();
            message.handleMetaSlotChange();

            expect(message.hasAvatar).toBe(false);
            expect(message.hasMeta).toBe(false);
        });

        it("reacts to avatar and meta content added and removed after first render", async () => {
            const message = await renderMessage();
            const avatar = document.createElement("span");
            avatar.slot = "avatar";
            avatar.textContent = "A";
            const meta = document.createElement("span");
            meta.slot = "meta";
            meta.textContent = "now";

            message.append(avatar, meta);
            await settle();
            expect(partOf(message, "avatar").hidden).toBe(false);
            expect(partOf(message, "meta").hidden).toBe(false);

            avatar.remove();
            meta.remove();
            await settle();
            expect(partOf(message, "avatar").hidden).toBe(true);
            expect(partOf(message, "meta").hidden).toBe(true);
        });
    });

    describe("role layout", () => {
        it("reverses the row for user messages only", async () => {
            const user = await renderMessage('message-role="user"');
            expect(getComputedStyle(partOf(user, "root")).flexDirection).toBe("row-reverse");

            const assistant = await renderMessage('message-role="assistant"');
            expect(getComputedStyle(partOf(assistant, "root")).flexDirection).toBe("row");

            const system = await renderMessage('message-role="system"');
            expect(getComputedStyle(partOf(system, "root")).flexDirection).toBe("row");
        });

        it("lets system messages use the full width and centre their text", async () => {
            const system = await renderMessage('message-role="system"');
            const surface = getComputedStyle(partOf(system, "surface"));

            expect(surface.textAlign).toBe("center");
            expect(surface.maxWidth).toBe("100%");
        });

        it("dims muted messages", async () => {
            const muted = await renderMessage('tone="muted"');

            expect(getComputedStyle(partOf(muted, "surface")).opacity).toBe("0.7");
        });
    });
});
