import { Observable } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it } from "vitest";

import "./violet-chat-composer";
import type { VioletChatComposer } from "./violet-chat-composer";

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

ensureObservables("violet-chat-composer", ["hasInput", "hasActions", "hasFooter"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderComposer(status = "ready", value = ""): Promise<VioletChatComposer> {
    document.body.innerHTML = "";
    const composer = document.createElement("violet-chat-composer") as VioletChatComposer;
    composer.status = status;
    composer.setAttribute("label", "Message");
    if (value) {
        composer.value = value;
    }
    document.body.append(composer);
    await customElements.whenDefined("violet-chat-composer");
    await nextFrame();
    await nextFrame();
    return composer;
}

function keydown(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    if (init.keyCode !== undefined) {
        Object.defineProperty(event, "keyCode", { value: init.keyCode });
    }
    return event;
}

function collectSubmissions(composer: VioletChatComposer): string[] {
    const submitted: string[] = [];
    composer.addEventListener("submit", ((event: CustomEvent<{ text: string }>) => {
        submitted.push(event.detail.text);
    }) as EventListener);
    return submitted;
}

function typeInto(composer: VioletChatComposer, text: string): void {
    const textarea = composer.textareaEl;
    if (!textarea) {
        throw new Error("Expected composer textarea to render.");
    }
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

async function renderFromMarkup(markup: string): Promise<VioletChatComposer> {
    document.body.innerHTML = markup;
    await customElements.whenDefined("violet-chat-composer");
    await nextFrame();
    await nextFrame();
    return document.querySelector("violet-chat-composer") as VioletChatComposer;
}

function partOf(composer: VioletChatComposer, part: string): HTMLElement | null {
    return composer.shadowRoot?.querySelector<HTMLElement>(`[part="${part}"]`) ?? null;
}

function typeAndSettle(composer: VioletChatComposer, text: string): Promise<void> {
    typeInto(composer, text);
    return nextFrame();
}

function pressOnTextarea(composer: VioletChatComposer, init: KeyboardEventInit): KeyboardEvent {
    const textarea = composer.textareaEl;
    if (!textarea) {
        throw new Error("Expected composer textarea to render.");
    }
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    textarea.dispatchEvent(event);
    return event;
}

describe("violet-chat-composer", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("does not reflect typed draft text into the value attribute", async () => {
        const composer = await renderComposer();

        typeInto(composer, "draft with a secret");
        await nextFrame();

        expect(composer.value).toBe("draft with a secret");
        expect(composer.hasAttribute("value")).toBe(false);
    });

    it("still reads an initial value attribute", async () => {
        document.body.innerHTML = "";
        const composer = document.createElement("violet-chat-composer") as VioletChatComposer;
        composer.setAttribute("value", "Prefilled");
        document.body.append(composer);
        await nextFrame();

        expect(composer.value).toBe("Prefilled");
    });

    it("submits on Enter", async () => {
        const composer = await renderComposer();
        const submitted = collectSubmissions(composer);
        typeInto(composer, "hello");

        const event = keydown({ key: "Enter" });
        const handledDefault = composer.handleKeydown(event);

        expect(handledDefault).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(submitted).toEqual(["hello"]);
    });

    it("does not submit on Shift+Enter", async () => {
        const composer = await renderComposer();
        const submitted = collectSubmissions(composer);
        typeInto(composer, "hello");

        const event = keydown({ key: "Enter", shiftKey: true });

        expect(composer.handleKeydown(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        expect(submitted).toEqual([]);
    });

    it.each([
        ["isComposing", { key: "Enter", isComposing: true }],
        ["keyCode 229", { key: "Enter", keyCode: 229 }],
    ])("does not submit on Enter during IME composition (%s)", async (_label, init) => {
        const composer = await renderComposer();
        const submitted = collectSubmissions(composer);
        typeInto(composer, "こんにちは");

        const event = keydown(init);

        expect(composer.handleKeydown(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        expect(submitted).toEqual([]);
    });

    it("does not map Enter to stop while streaming, but the Stop button still stops", async () => {
        const composer = await renderComposer("streaming");
        const stops: Event[] = [];
        const submitted = collectSubmissions(composer);
        composer.addEventListener("stop", event => stops.push(event));

        composer.handleKeydown(keydown({ key: "Enter" }));
        expect(stops).toHaveLength(0);
        expect(submitted).toEqual([]);

        const stopButton = composer.shadowRoot?.querySelector<HTMLElement>('[part="stop-button"]');
        expect(stopButton).not.toBeNull();
        stopButton?.click();
        expect(stops).toHaveLength(1);
    });

    describe("attributes and properties", () => {
        it("has ready defaults", async () => {
            const composer = await renderFromMarkup("<violet-chat-composer></violet-chat-composer>");

            expect(composer.status).toBe("ready");
            expect(composer.placeholder).toBe("Send a message…");
            expect(composer.label).toBe("Message");
            expect(composer.disabled).toBe(false);
            expect(composer.value).toBe("");
        });

        it("reads status, placeholder, label and disabled from attributes", async () => {
            const composer = await renderFromMarkup(
                '<violet-chat-composer status="streaming" placeholder="Ask away" label="Prompt" disabled></violet-chat-composer>',
            );

            expect(composer.status).toBe("streaming");
            expect(composer.placeholder).toBe("Ask away");
            expect(composer.label).toBe("Prompt");
            expect(composer.disabled).toBe(true);
        });

        it("reflects status, placeholder, label and disabled properties to attributes", async () => {
            const composer = await renderComposer();

            composer.status = "submitted";
            composer.placeholder = "Type here";
            composer.label = "Chat input";
            composer.disabled = true;
            await nextFrame();

            expect(composer.getAttribute("status")).toBe("submitted");
            expect(composer.getAttribute("placeholder")).toBe("Type here");
            expect(composer.getAttribute("label")).toBe("Chat input");
            expect(composer.getAttribute("disabled")).toBe("");

            composer.disabled = false;
            await nextFrame();
            expect(composer.hasAttribute("disabled")).toBe(false);
        });

        it("updates properties when attributes change after connection", async () => {
            const composer = await renderComposer();

            composer.setAttribute("status", "error");
            composer.setAttribute("disabled", "");
            await nextFrame();

            expect(composer.status).toBe("error");
            expect(composer.disabled).toBe(true);

            composer.removeAttribute("disabled");
            await nextFrame();
            expect(composer.disabled).toBe(false);
        });

        it("does not write the value property back to the attribute", async () => {
            const composer = await renderComposer();

            composer.value = "programmatic draft";
            await nextFrame();

            expect(composer.hasAttribute("value")).toBe(false);
        });

        it("forwards label and placeholder to the inner text area", async () => {
            const composer = await renderFromMarkup(
                '<violet-chat-composer label="Prompt" placeholder="Ask away"></violet-chat-composer>',
            );
            const field = composer.textAreaField;

            expect(field?.getAttribute("label")).toBe("Prompt");
            expect(field?.getAttribute("placeholder")).toBe("Ask away");

            composer.label = "Question";
            composer.placeholder = "Go on";
            await nextFrame();
            expect(field?.getAttribute("label")).toBe("Question");
            expect(field?.getAttribute("placeholder")).toBe("Go on");
        });

        it("pushes a programmatic value into the textarea", async () => {
            const composer = await renderComposer();

            composer.value = "from code";
            await nextFrame();
            await nextFrame();

            expect(composer.textareaEl?.value).toBe("from code");
            expect(composer.canSubmit).toBe(true);
        });
    });

    describe("disabled and empty state", () => {
        it("disables the send button and submit when there is no text", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            const button = partOf(composer, "submit-button");

            expect(composer.canSubmit).toBe(false);
            expect(button?.hasAttribute("disabled")).toBe(true);

            composer.handleSubmit();
            expect(submitted).toEqual([]);
        });

        it("keeps the send button disabled for whitespace-only input", async () => {
            const composer = await renderComposer();

            await typeAndSettle(composer, "   \n  ");

            expect(composer.canSubmit).toBe(false);
            expect(partOf(composer, "submit-button")?.hasAttribute("disabled")).toBe(true);
        });

        it("enables the send button once there is text, and disables it again when cleared", async () => {
            const composer = await renderComposer();

            await typeAndSettle(composer, "hello");
            expect(composer.canSubmit).toBe(true);
            expect(partOf(composer, "submit-button")?.hasAttribute("disabled")).toBe(false);

            await typeAndSettle(composer, "");
            expect(composer.canSubmit).toBe(false);
            expect(partOf(composer, "submit-button")?.hasAttribute("disabled")).toBe(true);
        });

        it("labels the send button for assistive technology", async () => {
            const composer = await renderComposer();

            expect(partOf(composer, "submit-button")?.getAttribute("label")).toBe("Send message");
        });

        it("does not submit empty or whitespace-only input on Enter", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);

            composer.handleKeydown(keydown({ key: "Enter" }));
            typeInto(composer, "   ");
            composer.handleKeydown(keydown({ key: "Enter" }));

            expect(submitted).toEqual([]);
        });

        it("still cancels the Enter default for empty input so no stray newline is inserted", async () => {
            const composer = await renderComposer();
            const event = keydown({ key: "Enter" });

            expect(composer.handleKeydown(event)).toBe(false);
            expect(event.defaultPrevented).toBe(true);
        });

        it("disables the text area and blocks submission when disabled", async () => {
            const composer = await renderComposer();
            typeInto(composer, "hello");
            const submitted = collectSubmissions(composer);

            composer.disabled = true;
            await nextFrame();

            expect(composer.textAreaField?.hasAttribute("disabled")).toBe(true);
            expect(composer.canSubmit).toBe(false);
            expect(partOf(composer, "submit-button")?.hasAttribute("disabled")).toBe(true);
            composer.handleKeydown(keydown({ key: "Enter" }));
            composer.handleSubmit();
            expect(submitted).toEqual([]);
        });

        it.each(["submitted", "streaming"])("disables input and submission while %s", async status => {
            const composer = await renderComposer(status, "pending draft");
            const submitted = collectSubmissions(composer);

            expect(composer.textAreaField?.hasAttribute("disabled")).toBe(true);
            expect(composer.canSubmit).toBe(false);
            composer.handleSubmit();
            expect(submitted).toEqual([]);
        });

        it.each(["ready", "error"])("keeps input enabled when status is %s", async status => {
            const composer = await renderComposer(status);

            expect(composer.textAreaField?.hasAttribute("disabled")).toBe(false);
        });
    });

    describe("submit events", () => {
        it("emits a bubbling, composed submit event with the trimmed text", async () => {
            const composer = await renderComposer();
            const events: CustomEvent<{ text: string }>[] = [];
            document.body.addEventListener("submit", ((event: CustomEvent<{ text: string }>) => {
                events.push(event);
            }) as EventListener);
            typeInto(composer, "  hello world \n");

            composer.handleSubmit();

            expect(events).toHaveLength(1);
            expect(events[0]?.detail).toEqual({ text: "hello world" });
            expect(events[0]?.bubbles).toBe(true);
            expect(events[0]?.composed).toBe(true);
        });

        it("clears the textarea, value and send button after submitting", async () => {
            const composer = await renderComposer();
            await typeAndSettle(composer, "hello");

            composer.handleSubmit();
            await nextFrame();

            expect(composer.value).toBe("");
            expect(composer.textareaEl?.value).toBe("");
            expect(composer.hasInput).toBe(false);
            expect(composer.canSubmit).toBe(false);
            expect(partOf(composer, "submit-button")?.hasAttribute("disabled")).toBe(true);
        });

        it("submits when the send button is clicked", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            await typeAndSettle(composer, "from the button");

            partOf(composer, "submit-button")?.click();

            expect(submitted).toEqual(["from the button"]);
        });

        it("does not submit when a disabled send button is clicked", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);

            partOf(composer, "submit-button")?.click();

            expect(submitted).toEqual([]);
        });

        it("submits once per Enter even for back-to-back messages", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);

            typeInto(composer, "first");
            composer.handleKeydown(keydown({ key: "Enter" }));
            typeInto(composer, "second");
            composer.handleKeydown(keydown({ key: "Enter" }));
            composer.handleKeydown(keydown({ key: "Enter" }));

            expect(submitted).toEqual(["first", "second"]);
        });

        it("submits multi-line text intact", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            typeInto(composer, "line one\nline two");

            composer.handleKeydown(keydown({ key: "Enter" }));

            expect(submitted).toEqual(["line one\nline two"]);
        });
    });

    describe("keyboard through the rendered textarea", () => {
        it("submits and cancels the default when Enter is pressed in the textarea", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            typeInto(composer, "typed in the field");

            const event = pressOnTextarea(composer, { key: "Enter" });

            expect(submitted).toEqual(["typed in the field"]);
            expect(event.defaultPrevented).toBe(true);
        });

        it("leaves Shift+Enter alone so the textarea inserts a newline", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            typeInto(composer, "line one");

            const event = pressOnTextarea(composer, { key: "Enter", shiftKey: true });

            expect(submitted).toEqual([]);
            expect(event.defaultPrevented).toBe(false);
        });

        it("ignores IME-confirming Enter pressed in the textarea", async () => {
            const composer = await renderComposer();
            const submitted = collectSubmissions(composer);
            typeInto(composer, "こんにちは");

            const event = pressOnTextarea(composer, { key: "Enter", isComposing: true });

            expect(submitted).toEqual([]);
            expect(event.defaultPrevented).toBe(false);
        });

        it("does not cancel the default for other keys", async () => {
            const composer = await renderComposer();
            typeInto(composer, "text");

            for (const key of ["a", "Tab", "Escape", "ArrowLeft"]) {
                expect(pressOnTextarea(composer, { key }).defaultPrevented).toBe(false);
            }
        });

        it("does not submit on Enter while streaming through the textarea", async () => {
            const composer = await renderComposer("streaming", "draft");
            const submitted = collectSubmissions(composer);
            const stops: Event[] = [];
            composer.addEventListener("stop", event => stops.push(event));

            pressOnTextarea(composer, { key: "Enter" });

            expect(submitted).toEqual([]);
            expect(stops).toHaveLength(0);
        });
    });

    describe("streaming controls", () => {
        it("swaps the send button for a labelled stop button while streaming", async () => {
            const composer = await renderComposer("streaming");

            expect(partOf(composer, "submit-button")).toBeNull();
            expect(partOf(composer, "stop-button")?.getAttribute("label")).toBe("Stop generating");
        });

        it("swaps back to the send button when streaming ends", async () => {
            const composer = await renderComposer("streaming");

            composer.status = "ready";
            await nextFrame();
            await nextFrame();

            expect(partOf(composer, "stop-button")).toBeNull();
            expect(partOf(composer, "submit-button")).not.toBeNull();
        });

        it("emits a bubbling stop event with no submit when Stop is clicked", async () => {
            const composer = await renderComposer("streaming");
            const stops: Event[] = [];
            const submitted = collectSubmissions(composer);
            document.body.addEventListener("stop", event => stops.push(event));

            partOf(composer, "stop-button")?.click();

            expect(stops).toHaveLength(1);
            expect(stops[0]?.bubbles).toBe(true);
            expect(submitted).toEqual([]);
        });

        it("shows the send button for ready, submitted and error statuses", async () => {
            for (const status of ["ready", "submitted", "error"]) {
                const composer = await renderComposer(status);

                expect(partOf(composer, "submit-button")).not.toBeNull();
                expect(partOf(composer, "stop-button")).toBeNull();
            }
        });
    });

    describe("slots", () => {
        it("hides the actions row and footer when nothing is slotted", async () => {
            const composer = await renderComposer();

            expect(composer.hasActions).toBe(false);
            expect(composer.hasFooter).toBe(false);
            expect(partOf(composer, "actions")?.hidden).toBe(true);
            expect(partOf(composer, "footer")?.hidden).toBe(true);
        });

        it("shows the actions row when an action is slotted", async () => {
            const composer = await renderFromMarkup(
                '<violet-chat-composer><button slot="actions">Attach</button></violet-chat-composer>',
            );
            const slot = partOf(composer, "actions")?.querySelector<HTMLSlotElement>("slot");

            expect(composer.hasActions).toBe(true);
            expect(partOf(composer, "actions")?.hidden).toBe(false);
            expect(partOf(composer, "footer")?.hidden).toBe(true);
            expect(slot?.assignedElements()[0]?.textContent).toBe("Attach");
        });

        it("shows the footer when footer content is slotted", async () => {
            const composer = await renderFromMarkup(
                '<violet-chat-composer><span slot="footer">128 tokens</span></violet-chat-composer>',
            );
            const slot = partOf(composer, "footer")?.querySelector<HTMLSlotElement>("slot");

            expect(composer.hasFooter).toBe(true);
            expect(partOf(composer, "footer")?.hidden).toBe(false);
            expect(partOf(composer, "actions")?.hidden).toBe(true);
            expect(slot?.assignedElements()[0]?.textContent).toBe("128 tokens");
        });

        it("ignores whitespace-only text in the slots", async () => {
            const composer = await renderFromMarkup("<violet-chat-composer>   </violet-chat-composer>");

            composer.handleActionsSlotChange();
            composer.handleFooterSlotChange();

            expect(composer.hasActions).toBe(false);
            expect(composer.hasFooter).toBe(false);
        });

        it("reacts to slotted content added and removed after first render", async () => {
            const composer = await renderComposer();
            const action = document.createElement("button");
            action.slot = "actions";
            action.textContent = "Attach";

            composer.append(action);
            await nextFrame();
            await nextFrame();
            expect(partOf(composer, "actions")?.hidden).toBe(false);

            action.remove();
            await nextFrame();
            await nextFrame();
            expect(partOf(composer, "actions")?.hidden).toBe(true);
        });
    });

    describe("focus", () => {
        it("delegates focus to the inner text area", async () => {
            const composer = await renderComposer();

            composer.focus();

            expect(document.activeElement).toBe(composer);
            expect(composer.shadowRoot?.activeElement).toBe(composer.textAreaField);
        });
    });
});
