import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid-pill-select";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridPillSelect } from "./violet-data-grid-pill-select";

const toneOptions: VioletDataGridEditorOption[] = [
    { value: "Direct Cover", label: "Direct Cover", tone: "olive" },
    { value: "Transplant Cover", label: "Transplant Cover", tone: "blue" },
    { value: "Direct Outside", label: "Direct Outside", tone: "green" },
];

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function waitForShadow<T>(get: () => T | null, description: string): Promise<T> {
    return vi.waitFor(() => {
        const value = get();
        expect(value, description).not.toBeNull();
        return value as T;
    });
}

async function renderPillSelect(): Promise<VioletDataGridPillSelect> {
    document.body.innerHTML = "";

    const element = document.createElement("violet-data-grid-pill-select") as VioletDataGridPillSelect;
    element.controlLabel = "Planting method";
    element.placeholder = "Choose a method";
    element.value = "Direct Cover";
    element.options = toneOptions;
    document.body.append(element);

    await customElements.whenDefined("violet-data-grid-pill-select");
    await nextFrame();

    return element;
}

describe("violet-data-grid-pill-select", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("opens from the trigger with arrow navigation and commits the focused option", async () => {
        const element = await renderPillSelect();
        const shadowRoot = element.shadowRoot;
        const trigger = shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;

        if (!trigger) throw new Error("Expected the pill-select trigger.");
        trigger.focus();
        await userEvent.keyboard("{ArrowDown}");
        await nextFrame();

        expect(element.open).toBe(true);

        const selectedOption = shadowRoot?.querySelector(
            '.option[data-option-value="Direct Cover"]'
        ) as HTMLButtonElement | null;
        expect(shadowRoot?.activeElement).toBe(selectedOption);

        await userEvent.keyboard("{ArrowDown}");
        await nextFrame();

        const nextOption = shadowRoot?.querySelector(
            '.option[data-option-value="Transplant Cover"]'
        ) as HTMLButtonElement | null;
        expect(shadowRoot?.activeElement).toBe(nextOption);
        const focusedPill = nextOption?.querySelector<HTMLElement>(".option-pill");
        expect(focusedPill ? getComputedStyle(focusedPill).boxShadow : "none").toContain("2px");

        await userEvent.keyboard("{Enter}");
        await nextFrame();

        expect(element.value).toBe("Transplant Cover");
        expect(element.open).toBe(false);
        expect(shadowRoot?.activeElement).toBe(trigger);
    });

    it("places invalid state and its explanation on the focused trigger", async () => {
        const element = (await renderPillSelect()) as VioletDataGridPillSelect & {
            invalid: boolean;
            errorText: string;
        };
        element.invalid = true;
        element.errorText = "Choose a supported planting method.";
        await nextFrame();

        const trigger = element.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        trigger?.focus();
        const messageId = trigger?.getAttribute("aria-errormessage");

        expect(element.shadowRoot?.activeElement).toBe(trigger);
        expect(trigger?.getAttribute("aria-invalid")).toBe("true");
        expect(messageId).toBeTruthy();
        const alert = element.shadowRoot?.querySelector('[part="error-text"][role="alert"]');
        expect(alert?.id).toBe(messageId);
        expect(alert?.textContent?.trim()).toBe(
            "Choose a supported planting method."
        );

        element.errorText = "Choose a different planting method.";
        await nextFrame();
        expect(element.shadowRoot?.querySelector('[part="error-text"][role="alert"]')?.textContent?.trim()).toBe(
            "Choose a different planting method."
        );

        element.errorText = "";
        await nextFrame();
        expect(element.shadowRoot?.querySelector('[part="error-text"][role="alert"]')).toBeNull();
        expect(trigger?.hasAttribute("aria-errormessage")).toBe(false);

        element.errorText = "Choose a listed planting method.";
        await nextFrame();
        const revalidatedAlert = element.shadowRoot?.querySelector(
            '[part="error-text"][role="alert"]'
        );
        expect(revalidatedAlert?.id).toBe(trigger?.getAttribute("aria-errormessage"));
        expect(revalidatedAlert?.textContent?.trim()).toBe("Choose a listed planting method.");

        element.invalid = false;
        await nextFrame();
        expect(trigger?.hasAttribute("aria-invalid")).toBe(false);
        expect(trigger?.hasAttribute("aria-errormessage")).toBe(false);
        expect(element.shadowRoot?.getElementById(messageId ?? "")).toBeNull();
    });

    it("keeps its error association when an integrating surface owns announcement", async () => {
        const element = await renderPillSelect();
        element.errorAnnouncement = "external";
        element.invalid = true;
        element.errorText = "Choose a supported planting method.";
        await nextFrame();

        const trigger = element.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        const messageId = trigger?.getAttribute("aria-errormessage");
        const message = element.shadowRoot?.getElementById(messageId ?? "");

        expect(trigger?.getAttribute("aria-invalid")).toBe("true");
        expect(messageId).toBeTruthy();
        expect(message?.textContent?.trim()).toBe("Choose a supported planting method.");
        expect(message?.hasAttribute("role")).toBe(false);
        expect(element.shadowRoot?.querySelectorAll('[role="alert"]')).toHaveLength(0);
    });

    it("closes when clicking outside the component document context", async () => {
        const element = await renderPillSelect();

        element.handleTriggerClick();
        await nextFrame();

        expect(element.open).toBe(true);

        document.body.dispatchEvent(
            new PointerEvent("pointerdown", {
                bubbles: true,
            })
        );
        await nextFrame();

        expect(element.open).toBe(false);
    });

    it("keeps native search editing and focus traversal while handling rendered keyboard selection", async () => {
        const element = await renderPillSelect();
        const shadowRoot = element.shadowRoot;
        const trigger = shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        const before = document.createElement("button");
        const outside = document.createElement("button");
        before.textContent = "Before";
        outside.textContent = "Outside";
        document.body.prepend(before);
        document.body.append(outside);

        if (!trigger) {
            throw new Error("Expected pill select trigger to render.");
        }
        expect(trigger?.getAttribute("aria-label")).toBe("Planting method: Direct Cover");

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(element.open).toBe(true));
        const escapeEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Escape",
        });
        const openWithSpace = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: " ",
        });
        const searchBeforeEscape = await waitForShadow(
            () => shadowRoot?.querySelector<HTMLInputElement>(".search") ?? null,
            "Expected pill select search to render before closing."
        );
        searchBeforeEscape.dispatchEvent(escapeEvent);
        await vi.waitFor(() => expect(element.open).toBe(false));
        trigger.dispatchEvent(openWithSpace);
        expect(openWithSpace.defaultPrevented).toBe(true);
        const search = await waitForShadow(
            () => shadowRoot?.querySelector<HTMLInputElement>(".search") ?? null,
            "Expected pill select search to render."
        );
        expect(element.open).toBe(true);
        await nextFrame();
        search.focus();
        await userEvent.fill(search, "grow");
        expect(search.value).toBe("grow");
        await userEvent.keyboard("{ArrowLeft}");
        await userEvent.keyboard("{Backspace}");
        expect(search.value).toBe("grw");
        await vi.waitFor(() => expect(element.filterQuery).toBe("grw"));
        const backspace = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Backspace",
        });
        search.dispatchEvent(backspace);
        expect(backspace.defaultPrevented).toBe(false);

        await userEvent.fill(search, "");
        expect(search.value).toBe("");
        await vi.waitFor(() => expect(element.filterQuery).toBe(""));
        await waitForShadow(
            () => shadowRoot?.querySelector<HTMLButtonElement>(".option") ?? null,
            "Expected pill select options to rerender after clearing search."
        );
        const moveDown = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "ArrowDown",
        });
        search.dispatchEvent(moveDown);
        expect(moveDown.defaultPrevented).toBe(true);
        const firstOption = shadowRoot?.querySelector<HTMLButtonElement>(".option");
        expect(shadowRoot?.activeElement).toBe(firstOption);
        const commit = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Enter",
        });
        firstOption?.dispatchEvent(commit);
        expect(commit.defaultPrevented).toBe(true);
        await nextFrame();

        expect(element.value).toBe("Direct Cover");
        expect(element.open).toBe(false);

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(element.open).toBe(true));
        const forwardTab = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Tab",
        });
        shadowRoot?.querySelector<HTMLElement>(".search")?.dispatchEvent(forwardTab);
        expect(forwardTab.defaultPrevented).toBe(false);
        outside.focus();
        await nextFrame();
        expect(element.open).toBe(false);
        expect(document.activeElement).toBe(outside);

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(element.open).toBe(true));
        const reverseTab = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Tab",
            shiftKey: true,
        });
        shadowRoot?.querySelector<HTMLElement>(".search")?.dispatchEvent(reverseTab);
        expect(reverseTab.defaultPrevented).toBe(false);
        before.focus();
        await nextFrame();
        expect(element.open).toBe(false);
        expect(document.activeElement).toBe(before);
    });

    it("passes composing keys through the rendered search and preserves internal focus transfers", async () => {
        const outside = document.createElement("button");
        outside.textContent = "Outside";
        document.body.append(outside);

        const element = await renderPillSelect();
        const shadowRoot = element.shadowRoot;
        const trigger = shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        if (!trigger) {
            throw new Error("Expected pill select trigger to render.");
        }

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(element.open).toBe(true));
        const search = await waitForShadow(
            () => shadowRoot?.querySelector<HTMLInputElement>(".search") ?? null,
            "Expected pill select search to render."
        );

        const composingEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            isComposing: true,
            key: "ArrowDown",
        });
        search.dispatchEvent(composingEvent);
        expect(composingEvent.defaultPrevented).toBe(false);
        expect(shadowRoot?.activeElement).toBe(search);
        const composingEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            isComposing: true,
            key: "Enter",
        });
        search.dispatchEvent(composingEnter);
        expect(composingEnter.defaultPrevented).toBe(false);
        expect(element.open).toBe(true);

        const option = shadowRoot?.querySelector<HTMLButtonElement>(".option");
        expect(option).not.toBeNull();
        option?.focus();
        expect(element.open).toBe(true);

        const focusOut = new FocusEvent("focusout", {
            bubbles: true,
            composed: true,
            relatedTarget: outside,
        });
        search.dispatchEvent(focusOut);
        await vi.waitFor(() => expect(element.open).toBe(false));
        await nextFrame();
        expect(element.open).toBe(false);
    });

    it("opens and restores trigger focus for Enter and Escape", async () => {
        const element = await renderPillSelect();
        const shadowRoot = element.shadowRoot;
        const trigger = shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        if (!trigger) {
            throw new Error("Expected pill select trigger to render.");
        }

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(element.open).toBe(true));
        const escapeEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Escape",
        });
        const searchBeforeEscape = await waitForShadow(
            () => shadowRoot?.querySelector<HTMLInputElement>(".search") ?? null,
            "Expected pill select search to render before closing."
        );
        searchBeforeEscape.dispatchEvent(escapeEvent);
        await vi.waitFor(() => expect(element.open).toBe(false));
        const enter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Enter",
        });
        trigger.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(element.open).toBe(true));
        expect(element.open).toBe(true);

        const secondEscape = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Escape",
        });
        const searchBeforeSecondEscape = await waitForShadow(
            () => shadowRoot?.querySelector<HTMLInputElement>(".search") ?? null,
            "Expected pill select search to render before restoring focus."
        );
        searchBeforeSecondEscape.dispatchEvent(secondEscape);
        await vi.waitFor(() => expect(element.open).toBe(false));
        expect(element.open).toBe(false);
        await nextFrame();
        expect(shadowRoot?.activeElement).toBe(trigger);

        element.value = "unknown-value";
        await nextFrame();
        expect(element.selectedLabel).toBe("unknown-value");
        expect(trigger?.getAttribute("aria-label")).toBe("Planting method: unknown-value");
    });

    it("ignores option colours that would inject extra declarations into the inline style", async () => {
        const element = await renderPillSelect();

        expect(
            element.optionStyle({
                value: "ok",
                label: "ok",
                background: "#123456",
                foreground: "white",
                borderColor: "rgb(1 2 3)",
            }),
        ).toBe("background:#123456;color:white;border-color:rgb(1 2 3);");

        const hostile = element.optionStyle({
            value: "bad",
            label: "bad",
            background: "red;position:fixed;inset:0",
            foreground: "blue}*{display:none",
            borderColor: "url(https://example.com/track.png)",
        });

        expect(hostile).toBe("background:var(--_surface-subtle);color:var(--_text-primary);border-color:transparent;");
    });
});
