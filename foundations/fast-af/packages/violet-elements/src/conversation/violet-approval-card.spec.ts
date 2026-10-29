import { Observable } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it } from "vitest";

import "./violet-approval-card";
import type { VioletApprovalCard } from "./violet-approval-card";

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

ensureObservables("violet-approval-card", ["hasSummary", "hasDetail"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

async function renderCard(attrs = "", content = ""): Promise<VioletApprovalCard> {
    document.body.innerHTML = `<violet-approval-card ${attrs}>${content}</violet-approval-card>`;
    await customElements.whenDefined("violet-approval-card");
    await settle();
    return document.querySelector("violet-approval-card") as VioletApprovalCard;
}

function partOf(card: VioletApprovalCard, part: string): HTMLElement | null {
    return card.shadowRoot?.querySelector<HTMLElement>(`[part="${part}"]`) ?? null;
}

function textOf(card: VioletApprovalCard, selector: string): string {
    return card.shadowRoot?.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("violet-approval-card", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and properties", () => {
        it("defaults to the pending state", async () => {
            const card = await renderCard();

            expect(card.state).toBe("pending");
        });

        it("reads state from the attribute and reflects property changes", async () => {
            const card = await renderCard('state="approved"');
            expect(card.state).toBe("approved");

            card.state = "denied";
            await settle();
            expect(card.getAttribute("state")).toBe("denied");
        });
    });

    describe("header", () => {
        it.each([
            ["pending", "Approval required", "Pending", "system/warning"],
            ["approved", "Approved", "Confirmed", "system/checkmark"],
            ["denied", "Denied", "Blocked", "system/dismiss"],
        ])("renders the %s title, chip and icon", async (state, title, chip, icon) => {
            const card = await renderCard(`state="${state}"`);

            expect(textOf(card, ".header-title")).toBe(title);
            expect(partOf(card, "status-chip")?.textContent?.trim()).toBe(chip);
            const headerIcon = card.shadowRoot?.querySelector(".header-icon violet-icon");
            expect(headerIcon?.getAttribute("icon")).toBe(icon);
            expect(headerIcon?.hasAttribute("decorative")).toBe(true);
        });

        it("falls back to pending presentation for unknown states", async () => {
            const card = await renderCard('state="weird"');

            expect(textOf(card, ".header-title")).toBe("Approval required");
            expect(partOf(card, "status-chip")?.textContent?.trim()).toBe("Pending");
        });

        it("updates the header when the state changes", async () => {
            const card = await renderCard();

            card.state = "approved";
            await settle();

            expect(textOf(card, ".header-title")).toBe("Approved");
        });

        it("labels the surrounding card for assistive technology", async () => {
            const card = await renderCard();

            expect(card.shadowRoot?.querySelector("violet-card")?.getAttribute("aria-label")).toBe("Action requires approval");
        });
    });

    describe("default actions", () => {
        it("renders Approve and Deny buttons while pending", async () => {
            const card = await renderCard();
            const approve = partOf(card, "approve-button");
            const deny = partOf(card, "deny-button");

            expect(approve?.textContent?.trim()).toBe("Approve");
            expect(approve?.getAttribute("appearance")).toBe("primary");
            expect(deny?.textContent?.trim()).toBe("Deny");
            expect(deny?.getAttribute("appearance")).toBe("secondary");
            expect(partOf(card, "actions")?.hidden).toBe(false);
        });

        it("emits approve when Approve is clicked", async () => {
            const card = await renderCard();
            const events: Event[] = [];
            card.addEventListener("approve", event => events.push(event));

            partOf(card, "approve-button")?.click();

            expect(events).toHaveLength(1);
            expect(events[0]?.bubbles).toBe(true);
            expect(events[0]?.composed).toBe(true);
        });

        it("emits deny when Deny is clicked", async () => {
            const card = await renderCard();
            const approvals: Event[] = [];
            const denials: Event[] = [];
            card.addEventListener("approve", event => approvals.push(event));
            card.addEventListener("deny", event => denials.push(event));

            partOf(card, "deny-button")?.click();

            expect(denials).toHaveLength(1);
            expect(approvals).toHaveLength(0);
        });

        it("emits through handleApprove() and handleDeny()", async () => {
            const card = await renderCard();
            const names: string[] = [];
            card.addEventListener("approve", () => names.push("approve"));
            card.addEventListener("deny", () => names.push("deny"));

            card.handleApprove();
            card.handleDeny();

            expect(names).toEqual(["approve", "deny"]);
        });

        it.each(["approved", "denied"])("hides the action row once %s", async state => {
            const card = await renderCard(`state="${state}"`);

            expect(partOf(card, "actions")?.hidden).toBe(true);
        });

        it("hides and shows the action row as the state changes", async () => {
            const card = await renderCard();
            expect(partOf(card, "actions")?.hidden).toBe(false);

            card.state = "approved";
            await settle();
            expect(partOf(card, "actions")?.hidden).toBe(true);

            card.state = "pending";
            await settle();
            expect(partOf(card, "actions")?.hidden).toBe(false);
        });
    });

    describe("slots", () => {
        it("replaces the default buttons with slotted actions", async () => {
            const card = await renderCard("", '<button slot="actions" id="custom">Allow once</button>');
            const slot = partOf(card, "actions")?.querySelector<HTMLSlotElement>('slot[name="actions"]');

            expect(slot?.assignedElements()[0]?.id).toBe("custom");
            expect(slot?.assignedElements({ flatten: true })).toHaveLength(1);
        });

        it("hides the summary and detail sections when their slots are empty", async () => {
            const card = await renderCard();

            expect(card.hasSummary).toBe(false);
            expect(card.hasDetail).toBe(false);
            expect(partOf(card, "summary")?.hidden).toBe(true);
            expect(partOf(card, "detail")?.hidden).toBe(true);
        });

        it("shows the summary section when summary content is slotted", async () => {
            const card = await renderCard("", '<span slot="summary">Delete 3 files</span>');
            const slot = partOf(card, "summary")?.querySelector<HTMLSlotElement>("slot");

            expect(card.hasSummary).toBe(true);
            expect(partOf(card, "summary")?.hidden).toBe(false);
            expect(partOf(card, "detail")?.hidden).toBe(true);
            expect(slot?.assignedElements()[0]?.textContent).toBe("Delete 3 files");
        });

        it("shows the detail section when detail content is slotted", async () => {
            const card = await renderCard("", '<p slot="detail">This cannot be undone.</p>');
            const slot = partOf(card, "detail")?.querySelector<HTMLSlotElement>("slot");

            expect(card.hasDetail).toBe(true);
            expect(partOf(card, "detail")?.hidden).toBe(false);
            expect(partOf(card, "summary")?.hidden).toBe(true);
            expect(slot?.assignedElements()[0]?.textContent).toBe("This cannot be undone.");
        });

        it("ignores whitespace-only text in summary and detail slots", async () => {
            const card = await renderCard("", "   ");

            card.handleSummarySlotChange();
            card.handleDetailSlotChange();

            expect(card.hasSummary).toBe(false);
            expect(card.hasDetail).toBe(false);
        });

        it("reacts to summary content added later", async () => {
            const card = await renderCard();
            const summary = document.createElement("span");
            summary.slot = "summary";
            summary.textContent = "Later summary";

            card.append(summary);
            await settle();

            expect(card.hasSummary).toBe(true);
            expect(partOf(card, "summary")?.hidden).toBe(false);
        });
    });
});
