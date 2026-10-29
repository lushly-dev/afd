import { Observable } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it } from "vitest";

import "./violet-tool-result-card";
import type { VioletToolResultCard } from "./violet-tool-result-card";

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

ensureObservables("violet-tool-result-card", ["hasFooter"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

async function renderCard(attrs = "", content = ""): Promise<VioletToolResultCard> {
    document.body.innerHTML = `<violet-tool-result-card ${attrs}>${content}</violet-tool-result-card>`;
    await customElements.whenDefined("violet-tool-result-card");
    await settle();
    return document.querySelector("violet-tool-result-card") as VioletToolResultCard;
}

function partOf(card: VioletToolResultCard, part: string): HTMLElement {
    const element = card.shadowRoot?.querySelector<HTMLElement>(`[part="${part}"]`);
    if (!element) {
        throw new Error(`Expected part "${part}" to render.`);
    }
    return element;
}

function summaryTextOf(card: VioletToolResultCard): string {
    return card.shadowRoot?.querySelector(".summary-text")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("violet-tool-result-card", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and properties", () => {
        it("defaults to pending and collapsed", async () => {
            const card = await renderCard();

            expect(card.state).toBe("pending");
            expect(card.expanded).toBe(false);
        });

        it("reads state and expanded from attributes", async () => {
            const card = await renderCard('state="output-available" expanded');

            expect(card.state).toBe("output-available");
            expect(card.expanded).toBe(true);
        });

        it("reflects state and expanded properties to attributes", async () => {
            const card = await renderCard();

            card.state = "output-error";
            card.expanded = true;
            await settle();

            expect(card.getAttribute("state")).toBe("output-error");
            expect(card.getAttribute("expanded")).toBe("");

            card.expanded = false;
            await settle();
            expect(card.hasAttribute("expanded")).toBe(false);
        });
    });

    describe("summary row", () => {
        it.each([
            ["output-error", "Tool failed"],
            ["output-available", "Tool completed"],
            ["executing", "Tool running"],
            ["pending", "Waiting for output"],
        ])("shows the default summary for %s", async (state, expected) => {
            const card = await renderCard(`state="${state}"`);

            expect(summaryTextOf(card)).toBe(expected);
        });

        it("updates the default summary when state changes", async () => {
            const card = await renderCard('state="executing"');

            card.state = "output-available";
            await settle();

            expect(summaryTextOf(card)).toBe("Tool completed");
        });

        it("lets slotted summary content replace the default text", async () => {
            const card = await renderCard('state="output-available"', '<span slot="summary">Found 3 results</span>');
            const slot = card.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="summary"]');

            expect(slot?.assignedElements()[0]?.textContent).toBe("Found 3 results");
        });

        it("renders the summary as a native button of type button", async () => {
            const card = await renderCard();
            const summary = partOf(card, "summary") as HTMLButtonElement;

            expect(summary.tagName).toBe("BUTTON");
            expect(summary.type).toBe("button");
        });

        it.each([
            ["output-available", "system/checkmark"],
            ["output-error", "system/dismiss"],
        ])("shows a decorative %s status icon", async (state, icon) => {
            const card = await renderCard(`state="${state}"`);
            const statusIcon = partOf(card, "status-icon").querySelector("violet-icon");

            expect(statusIcon?.getAttribute("icon")).toBe(icon);
            expect(statusIcon?.hasAttribute("decorative")).toBe(true);
            expect(partOf(card, "status-icon").querySelector(".spinner")).toBeNull();
        });

        it.each(["pending", "executing"])("shows a spinner instead of an icon while %s", async state => {
            const card = await renderCard(`state="${state}"`);
            const statusIcon = partOf(card, "status-icon");

            expect(statusIcon.querySelector(".spinner")).not.toBeNull();
            expect(statusIcon.querySelector("violet-icon")).toBeNull();
        });
    });

    describe("expand and collapse", () => {
        it("keeps the body collapsed by default with aria-expanded false", async () => {
            const card = await renderCard('state="output-available"', "Result body");

            expect(partOf(card, "summary").getAttribute("aria-expanded")).toBe("false");
            expect(partOf(card, "body").hidden).toBe(true);
        });

        it("starts expanded when the expanded attribute is set", async () => {
            const card = await renderCard('state="output-available" expanded', "Result body");

            expect(partOf(card, "summary").getAttribute("aria-expanded")).toBe("true");
            expect(partOf(card, "body").hidden).toBe(false);
        });

        it("toggles the body when the summary is clicked", async () => {
            const card = await renderCard('state="output-available"', "Result body");

            partOf(card, "summary").click();
            await settle();
            expect(card.expanded).toBe(true);
            expect(card.hasAttribute("expanded")).toBe(true);
            expect(partOf(card, "summary").getAttribute("aria-expanded")).toBe("true");
            expect(partOf(card, "body").hidden).toBe(false);

            partOf(card, "summary").click();
            await settle();
            expect(card.expanded).toBe(false);
            expect(partOf(card, "summary").getAttribute("aria-expanded")).toBe("false");
            expect(partOf(card, "body").hidden).toBe(true);
        });

        it("toggles in response to the expanded property and attribute", async () => {
            const card = await renderCard('state="output-available"', "Result body");

            card.expanded = true;
            await settle();
            expect(partOf(card, "body").hidden).toBe(false);

            card.removeAttribute("expanded");
            await settle();
            expect(card.expanded).toBe(false);
            expect(partOf(card, "body").hidden).toBe(true);
        });

        it("toggles via toggleExpanded()", async () => {
            const card = await renderCard();

            card.toggleExpanded();
            expect(card.expanded).toBe(true);
            card.toggleExpanded();
            expect(card.expanded).toBe(false);
        });

        it("projects default-slot content into the body", async () => {
            const card = await renderCard('state="output-available" expanded', "<pre>{ ok: true }</pre>");
            const slot = partOf(card, "body").querySelector<HTMLSlotElement>("slot");

            expect(slot?.assignedElements()[0]?.tagName).toBe("PRE");
        });
    });

    describe("footer", () => {
        it("hides the footer when no footer content is slotted, even when expanded", async () => {
            const card = await renderCard('state="output-available" expanded', "Result body");

            expect(card.hasFooter).toBe(false);
            expect(partOf(card, "footer").hidden).toBe(true);
        });

        it("shows the footer only when expanded and populated", async () => {
            const card = await renderCard('state="output-available"', 'Result<span slot="footer">120 ms</span>');

            expect(card.hasFooter).toBe(true);
            expect(partOf(card, "footer").hidden).toBe(true);

            card.expanded = true;
            await settle();
            expect(partOf(card, "footer").hidden).toBe(false);
            expect(
                partOf(card, "footer").querySelector<HTMLSlotElement>("slot")?.assignedElements()[0]?.textContent,
            ).toBe("120 ms");
        });

        it("ignores whitespace-only footer text", async () => {
            const card = await renderCard('state="output-available" expanded', '<span slot="footer">  </span>');

            // The wrapping element is a real node, so it counts as content; plain whitespace text does not.
            expect(card.hasFooter).toBe(true);

            const plain = await renderCard('state="output-available" expanded', "   ");
            expect(plain.hasFooter).toBe(false);
        });

        it("reacts to footer content added after the first render", async () => {
            const card = await renderCard('state="output-available" expanded', "Result body");
            const footer = document.createElement("span");
            footer.slot = "footer";
            footer.textContent = "later";

            card.append(footer);
            await settle();

            expect(card.hasFooter).toBe(true);
            expect(partOf(card, "footer").hidden).toBe(false);
        });
    });
});
