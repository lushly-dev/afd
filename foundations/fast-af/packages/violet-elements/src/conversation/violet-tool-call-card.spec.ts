import { Observable } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it } from "vitest";

import "./violet-tool-call-card";
import type { VioletApprovalCard } from "./violet-approval-card";
import type { VioletToolCallCard } from "./violet-tool-call-card";

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

ensureObservables("violet-tool-call-card", ["hasBody", "hasDetailContent"]);

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

async function renderCard(attrs = "", content = ""): Promise<VioletToolCallCard> {
    document.body.innerHTML = `<violet-tool-call-card ${attrs}>${content}</violet-tool-call-card>`;
    await customElements.whenDefined("violet-tool-call-card");
    await settle();
    return document.querySelector("violet-tool-call-card") as VioletToolCallCard;
}

function partOf(card: VioletToolCallCard, part: string): HTMLElement | null {
    return card.shadowRoot?.querySelector<HTMLElement>(`[part="${part}"]`) ?? null;
}

function approvalOf(card: VioletToolCallCard): VioletApprovalCard {
    const approval = card.shadowRoot?.querySelector<VioletApprovalCard>("violet-approval-card");
    if (!approval) {
        throw new Error("Expected the delegated approval card to render.");
    }
    return approval;
}

describe("violet-tool-call-card", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and properties", () => {
        it("has pending defaults", async () => {
            const card = await renderCard();

            expect(card.state).toBe("pending");
            expect(card.toolName).toBe("");
            expect(card.toolCallId).toBe("");
        });

        it("maps kebab-case attributes to camelCase properties", async () => {
            const card = await renderCard('tool-name="search_web" tool-call-id="call-42" state="executing"');

            expect(card.toolName).toBe("search_web");
            expect(card.toolCallId).toBe("call-42");
            expect(card.state).toBe("executing");
        });

        it("reflects properties back to attributes", async () => {
            const card = await renderCard();

            card.toolName = "read_file";
            card.toolCallId = "call-7";
            card.state = "output-available";
            await settle();

            expect(card.getAttribute("tool-name")).toBe("read_file");
            expect(card.getAttribute("tool-call-id")).toBe("call-7");
            expect(card.getAttribute("state")).toBe("output-available");
        });
    });

    describe("header and badge", () => {
        it("renders the tool name in the header", async () => {
            const card = await renderCard('tool-name="search_web"');

            expect(partOf(card, "name")?.textContent?.trim()).toBe("search_web");
        });

        it("labels the card as a region named after the tool", async () => {
            const card = await renderCard('tool-name="search_web"');
            const frame = card.shadowRoot?.querySelector(".frame");

            expect(frame?.getAttribute("role")).toBe("region");
            expect(frame?.getAttribute("aria-label")).toBe("Tool: search_web");

            card.toolName = "write_file";
            await settle();
            expect(frame?.getAttribute("aria-label")).toBe("Tool: write_file");
        });

        it.each([
            ["pending", "Preparing…"],
            ["executing", "Running…"],
            ["output-available", "Complete"],
            ["output-error", "Error"],
            ["cancelled", "Cancelled"],
        ])("shows the %s badge text", async (state, expected) => {
            const card = await renderCard(`tool-name="t" state="${state}"`);

            expect(partOf(card, "badge")?.textContent?.trim()).toBe(expected);
            expect(card.badgeText()).toBe(expected);
        });

        it("shows no badge text for an unknown state", async () => {
            const card = await renderCard('tool-name="t" state="mystery"');

            expect(card.badgeText()).toBe("");
            expect(partOf(card, "badge")?.textContent?.trim()).toBe("");
        });

        it("updates the badge when state changes", async () => {
            const card = await renderCard('tool-name="t" state="executing"');

            card.state = "output-error";
            await settle();

            expect(partOf(card, "badge")?.textContent?.trim()).toBe("Error");
        });

        it("falls back to the default settings icon and honours a custom icon slot", async () => {
            const card = await renderCard('tool-name="t"', '<span slot="icon" id="custom-icon">!</span>');
            const slot = card.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="icon"]');

            expect(slot?.assignedElements()[0]?.id).toBe("custom-icon");

            const defaultCard = await renderCard('tool-name="t"');
            const fallbackIcon = defaultCard.shadowRoot?.querySelector('slot[name="icon"] violet-icon');
            expect(fallbackIcon?.getAttribute("icon")).toBe("system/settings");
            expect(fallbackIcon?.hasAttribute("decorative")).toBe(true);
        });
    });

    describe("lifecycle states", () => {
        it("shows a loading shimmer and hides the body while pending", async () => {
            const card = await renderCard('tool-name="t" state="pending"', '<div slot="summary">Summary</div>');
            const shimmer = card.shadowRoot?.querySelector(".shimmer");

            expect(shimmer?.getAttribute("role")).toBe("status");
            expect(shimmer?.getAttribute("aria-label")).toBe("Loading");
            expect(partOf(card, "body")?.hidden).toBe(true);
        });

        it("shows a standalone spinner when executing without body content", async () => {
            const card = await renderCard('tool-name="t" state="executing"');
            // The empty (hidden) body also renders a spinner; only the visible one is exposed.
            const visibleSpinners = Array.from(card.shadowRoot?.querySelectorAll(".spinner") ?? []).filter(
                spinner => !spinner.closest("[hidden]"),
            );

            expect(partOf(card, "body")?.hidden).toBe(true);
            expect(visibleSpinners).toHaveLength(1);
            expect(visibleSpinners[0]?.getAttribute("role")).toBe("status");
            expect(visibleSpinners[0]?.getAttribute("aria-label")).toBe("Running");
            expect(card.shadowRoot?.querySelector(".shimmer")).toBeNull();
        });

        it("renders the spinner inside the body when executing with content", async () => {
            const card = await renderCard('tool-name="t" state="executing"', '<div slot="input">{"q":"x"}</div>');
            const body = partOf(card, "body");

            expect(body?.hidden).toBe(false);
            expect(body?.querySelectorAll(".spinner")).toHaveLength(1);
            expect(card.shadowRoot?.querySelectorAll(".spinner")).toHaveLength(1);
        });

        it("omits shimmer and spinner once output is available", async () => {
            const card = await renderCard('tool-name="t" state="output-available"');

            expect(card.shadowRoot?.querySelector(".shimmer")).toBeNull();
            expect(card.shadowRoot?.querySelector(".spinner")).toBeNull();
        });
    });

    describe("slots and body visibility", () => {
        it("hides the body when the card has no slotted content", async () => {
            const card = await renderCard('tool-name="t" state="output-available"');

            expect(card.hasBody).toBe(false);
            expect(partOf(card, "body")?.hidden).toBe(true);
        });

        it.each([
            ["summary", "Looks up the weather"],
            ["input", '{"city":"Oslo"}'],
            ["output", "12 degrees"],
        ])("shows the body when the %s slot has content", async (slotName, text) => {
            const card = await renderCard(
                'tool-name="t" state="output-available"',
                `<div slot="${slotName}">${text}</div>`,
            );
            const slot = card.shadowRoot?.querySelector<HTMLSlotElement>(`slot[name="${slotName}"]`);

            expect(card.hasBody).toBe(true);
            expect(partOf(card, "body")?.hidden).toBe(false);
            expect(slot?.assignedElements()[0]?.textContent).toBe(text);
        });

        it("shows the body for default-slot content", async () => {
            const card = await renderCard('tool-name="t" state="output-available"', "<p>Extra detail</p>");

            expect(card.hasBody).toBe(true);
            expect(partOf(card, "body")?.hidden).toBe(false);
        });

        it("ignores whitespace-only text in slots", async () => {
            const card = await renderCard('tool-name="t" state="output-available"', "   \n   ");

            expect(card.hasBody).toBe(false);
            expect(partOf(card, "body")?.hidden).toBe(true);
        });

        it("reacts to content being added after first render", async () => {
            const card = await renderCard('tool-name="t" state="output-available"');
            const output = document.createElement("div");
            output.slot = "output";
            output.textContent = "late result";

            card.append(output);
            await settle();

            expect(card.hasBody).toBe(true);
            expect(partOf(card, "body")?.hidden).toBe(false);
        });
    });

    describe("approval-requested", () => {
        it("delegates to a pending violet-approval-card instead of the framed card", async () => {
            const card = await renderCard('tool-name="delete_file" state="approval-requested"');
            const approval = approvalOf(card);

            expect(approval.getAttribute("state")).toBe("pending");
            expect(approval.getAttribute("part")).toBe("root");
            expect(card.shadowRoot?.querySelector("violet-card.frame")).toBeNull();
            expect(approval.querySelector(".approval-tool-name")?.textContent?.trim()).toBe("delete_file");
        });

        it("switches back to the framed card when the state leaves approval-requested", async () => {
            const card = await renderCard('tool-name="t" state="approval-requested"');

            card.state = "executing";
            await settle();

            expect(card.shadowRoot?.querySelector("violet-approval-card")).toBeNull();
            expect(card.shadowRoot?.querySelector("violet-card.frame")).not.toBeNull();
            expect(partOf(card, "badge")?.textContent?.trim()).toBe("Running…");
        });

        it("routes summary and detail content into the approval card", async () => {
            const card = await renderCard(
                'tool-name="t" state="approval-requested"',
                '<span slot="summary">Delete 3 files</span><pre slot="input">a.txt</pre>',
            );
            const approval = approvalOf(card);
            const detail = approval.querySelector<HTMLElement>(".approval-detail");

            expect(card.hasDetailContent).toBe(true);
            expect(detail?.hidden).toBe(false);
            expect(approval.querySelector('slot[name="summary"]')).not.toBeNull();
            expect(approval.querySelector('slot[name="input"]')).not.toBeNull();
        });

        it("hides the detail container when there is no input, output or default content", async () => {
            const card = await renderCard('tool-name="t" state="approval-requested"', '<span slot="summary">Only summary</span>');
            const detail = approvalOf(card).querySelector<HTMLElement>(".approval-detail");

            expect(card.hasDetailContent).toBe(false);
            expect(detail?.hidden).toBe(true);
        });

        it("emits approve with the toolCallId when the approval card is approved", async () => {
            const card = await renderCard('tool-name="t" tool-call-id="call-9" state="approval-requested"');
            const approvals: Array<{ toolCallId?: string } | undefined> = [];
            card.addEventListener("approve", event => approvals.push((event as CustomEvent).detail));

            approvalOf(card).shadowRoot?.querySelector<HTMLElement>('[part="approve-button"]')?.click();

            expect(approvals).toContainEqual({ toolCallId: "call-9" });
        });

        it("emits deny with the toolCallId when the approval card is denied", async () => {
            const card = await renderCard('tool-name="t" tool-call-id="call-9" state="approval-requested"');
            const denials: Array<{ toolCallId?: string } | undefined> = [];
            card.addEventListener("deny", event => denials.push((event as CustomEvent).detail));

            approvalOf(card).shadowRoot?.querySelector<HTMLElement>('[part="deny-button"]')?.click();

            expect(denials).toContainEqual({ toolCallId: "call-9" });
        });

        it("emits exactly one approve event to outside listeners per click", async () => {
            const card = await renderCard('tool-name="t" tool-call-id="call-9" state="approval-requested"');
            const approvals: Event[] = [];
            document.body.addEventListener("approve", event => approvals.push(event));

            approvalOf(card).shadowRoot?.querySelector<HTMLElement>('[part="approve-button"]')?.click();

            expect(approvals).toHaveLength(1);
        });
    });
});
