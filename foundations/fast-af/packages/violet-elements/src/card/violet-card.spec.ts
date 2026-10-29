import { afterEach, describe, expect, it } from "vitest";

import "./violet-card";
import type { VioletCard } from "./violet-card";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderCard(
    options: {
        header?: string;
        footer?: string;
        configure?: (card: VioletCard) => void;
    } = {}
): Promise<VioletCard> {
    document.body.innerHTML = "";

    const card = document.createElement("violet-card") as VioletCard;
    const body = document.createElement("p");
    body.textContent = "Body content";
    card.append(body);

    if (options.header) {
        const header = document.createElement("h3");
        header.slot = "header";
        header.textContent = options.header;
        card.append(header);
    }

    if (options.footer) {
        const footer = document.createElement("div");
        footer.slot = "footer";
        footer.textContent = options.footer;
        card.append(footer);
    }

    options.configure?.(card);
    document.body.append(card);

    await customElements.whenDefined("violet-card");
    await nextFrame();

    return card;
}

function section(card: VioletCard, name: "header" | "body" | "footer"): HTMLElement {
    const element = card.shadowRoot?.querySelector(`.${name}`) as HTMLElement | null;
    if (!element) {
        throw new Error(`violet-card did not render its ${name}`);
    }
    return element;
}

describe("violet-card", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("has defaults", async () => {
        const card = await renderCard();

        expect(card.padding).toBe("none");
        expect(card.appearance).toBe("filled");
        expect(card.orientation).toBe("vertical");
        expect(card.interactive).toBe(false);
    });

    it("maps attributes to properties", async () => {
        const card = await renderCard({
            configure: el => {
                el.setAttribute("padding", "large");
                el.setAttribute("appearance", "outline");
                el.setAttribute("orientation", "horizontal");
            },
        });

        expect(card.padding).toBe("large");
        expect(card.appearance).toBe("outline");
        expect(card.orientation).toBe("horizontal");
    });

    it("reflects property changes to attributes", async () => {
        const card = await renderCard();

        card.padding = "small";
        card.appearance = "subtle";
        card.orientation = "horizontal";
        await nextFrame();

        expect(card.getAttribute("padding")).toBe("small");
        expect(card.getAttribute("appearance")).toBe("subtle");
        expect(card.getAttribute("orientation")).toBe("horizontal");
    });

    it("projects body content into the default slot", async () => {
        const card = await renderCard();
        const slot = section(card, "body").querySelector("slot") as HTMLSlotElement;

        expect(slot.assignedElements().map(element => element.textContent)).toEqual(["Body content"]);
    });

    it("hides header and footer when their slots are empty", async () => {
        const card = await renderCard();

        expect(card.hasHeader).toBe(false);
        expect(card.hasFooter).toBe(false);
        expect(section(card, "header").hidden).toBe(true);
        expect(section(card, "footer").hidden).toBe(true);
    });

    it("shows header and footer when slotted content is present", async () => {
        const card = await renderCard({ header: "Title", footer: "Actions" });

        expect(card.hasHeader).toBe(true);
        expect(card.hasFooter).toBe(true);
        expect(section(card, "header").hidden).toBe(false);
        expect(section(card, "footer").hidden).toBe(false);

        const headerSlot = section(card, "header").querySelector("slot") as HTMLSlotElement;
        const footerSlot = section(card, "footer").querySelector("slot") as HTMLSlotElement;
        expect(headerSlot.assignedElements()[0]?.textContent).toBe("Title");
        expect(footerSlot.assignedElements()[0]?.textContent).toBe("Actions");
    });

    it("shows the header after content is slotted in later", async () => {
        const card = await renderCard();

        const header = document.createElement("h3");
        header.slot = "header";
        header.textContent = "Late title";
        card.append(header);
        await nextFrame();
        await nextFrame();

        expect(card.hasHeader).toBe(true);
        expect(section(card, "header").hidden).toBe(false);
    });

    describe("interactive mode", () => {
        it("is not focusable or a group by default", async () => {
            const card = await renderCard();

            expect(card.hasAttribute("tabindex")).toBe(false);
            expect(card.hasAttribute("role")).toBe(false);
        });

        it("adds tabindex and role=group when interactive", async () => {
            const card = await renderCard({
                configure: el => {
                    el.setAttribute("interactive", "");
                },
            });

            expect(card.interactive).toBe(true);
            expect(card.getAttribute("tabindex")).toBe("0");
            expect(card.getAttribute("role")).toBe("group");
        });

        it("adds and removes the semantics when interactive is toggled", async () => {
            const card = await renderCard();

            card.interactive = true;
            await nextFrame();
            expect(card.getAttribute("tabindex")).toBe("0");
            expect(card.getAttribute("role")).toBe("group");

            card.interactive = false;
            await nextFrame();
            expect(card.hasAttribute("tabindex")).toBe(false);
            expect(card.hasAttribute("role")).toBe(false);
        });

        it("preserves author-provided tabindex and role", async () => {
            const card = await renderCard({
                configure: el => {
                    el.setAttribute("tabindex", "-1");
                    el.setAttribute("role", "article");
                    el.setAttribute("interactive", "");
                },
            });

            expect(card.getAttribute("tabindex")).toBe("-1");
            expect(card.getAttribute("role")).toBe("article");

            card.interactive = false;
            await nextFrame();

            expect(card.getAttribute("tabindex")).toBe("-1");
            expect(card.getAttribute("role")).toBe("article");
        });
    });
});
