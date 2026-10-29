import { afterEach, describe, expect, it } from "vitest";

import "./violet-chat-suggestions";
import type { VioletChatSuggestions } from "./violet-chat-suggestions";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderSuggestions(
    attrs = "",
    content = "<button>Summarise this</button><button>Translate it</button><button>Explain more</button>",
): Promise<VioletChatSuggestions> {
    document.body.innerHTML = `<violet-chat-suggestions ${attrs}>${content}</violet-chat-suggestions>`;
    await customElements.whenDefined("violet-chat-suggestions");
    await nextFrame();
    await nextFrame();
    return document.querySelector("violet-chat-suggestions") as VioletChatSuggestions;
}

function collectSelections(suggestions: VioletChatSuggestions): string[] {
    const selected: string[] = [];
    suggestions.addEventListener("select", ((event: CustomEvent<{ text: string }>) => {
        selected.push(event.detail.text);
    }) as EventListener);
    return selected;
}

function chipsOf(suggestions: VioletChatSuggestions): HTMLElement[] {
    return Array.from(suggestions.children) as HTMLElement[];
}

function press(target: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    return event;
}

describe("violet-chat-suggestions", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and semantics", () => {
        it("defaults to a horizontal orientation", async () => {
            const suggestions = await renderSuggestions();

            expect(suggestions.orientation).toBe("horizontal");
            expect(getComputedStyle(suggestions.shadowRoot?.querySelector(".root") as Element).flexDirection).toBe("row");
        });

        it("stacks chips for the vertical orientation and reflects the property", async () => {
            const suggestions = await renderSuggestions('orientation="vertical"');
            const root = suggestions.shadowRoot?.querySelector(".root") as Element;

            expect(suggestions.orientation).toBe("vertical");
            expect(getComputedStyle(root).flexDirection).toBe("column");

            suggestions.orientation = "horizontal";
            await nextFrame();
            expect(suggestions.getAttribute("orientation")).toBe("horizontal");
            expect(getComputedStyle(root).flexDirection).toBe("row");
        });

        it("exposes a labelled group", async () => {
            const suggestions = await renderSuggestions();
            const root = suggestions.shadowRoot?.querySelector('[part="root"]');

            expect(root?.getAttribute("role")).toBe("group");
            expect(root?.getAttribute("aria-label")).toBe("Suggested prompts");
        });
    });

    describe("chip roles", () => {
        it("gives chips a button role and tab stop when they have none", async () => {
            const suggestions = await renderSuggestions("", "<span>One</span><span>Two</span>");

            for (const chip of chipsOf(suggestions)) {
                expect(chip.getAttribute("role")).toBe("button");
                expect(chip.getAttribute("tabindex")).toBe("0");
            }
        });

        it("keeps an explicit role and tabindex", async () => {
            const suggestions = await renderSuggestions("", '<span role="link" tabindex="-1">One</span>');
            const chip = chipsOf(suggestions)[0];

            expect(chip?.getAttribute("role")).toBe("link");
            expect(chip?.getAttribute("tabindex")).toBe("-1");
        });

        it("gives chips added after connection a role and tab stop", async () => {
            const suggestions = await renderSuggestions("", "");
            const chip = document.createElement("span");
            chip.textContent = "Late chip";

            suggestions.append(chip);
            await nextFrame();

            expect(chip.getAttribute("role")).toBe("button");
            expect(chip.getAttribute("tabindex")).toBe("0");
        });
    });

    describe("selection by pointer", () => {
        it("emits select with the trimmed chip text on click", async () => {
            const suggestions = await renderSuggestions("", "<button>  Summarise this  </button>");
            const selected = collectSelections(suggestions);

            chipsOf(suggestions)[0]?.click();

            expect(selected).toEqual(["Summarise this"]);
        });

        it("emits one select per click and the select event bubbles", async () => {
            const suggestions = await renderSuggestions();
            const selected: string[] = [];
            document.body.addEventListener("select", event => selected.push((event as CustomEvent<{ text: string }>).detail.text));

            chipsOf(suggestions)[1]?.click();
            chipsOf(suggestions)[2]?.click();

            expect(selected).toEqual(["Translate it", "Explain more"]);
        });

        it("ignores empty chips", async () => {
            const suggestions = await renderSuggestions("", "<button>   </button>");
            const selected = collectSelections(suggestions);

            chipsOf(suggestions)[0]?.click();

            expect(selected).toEqual([]);
        });

        it("ignores clicks on the host itself", async () => {
            const suggestions = await renderSuggestions();
            const selected = collectSelections(suggestions);

            suggestions.click();

            expect(selected).toEqual([]);
        });

        it("emits the whole chip text when a nested element is clicked", async () => {
            const suggestions = await renderSuggestions("", "<button>Ask about <strong>pricing</strong></button>");
            const selected = collectSelections(suggestions);

            suggestions.querySelector("strong")?.click();

            expect(selected).toEqual(["Ask about pricing"]);
        });
    });

    describe("keyboard", () => {
        it.each(["Enter", " "])("selects the focused chip with %j", async key => {
            const suggestions = await renderSuggestions();
            const selected = collectSelections(suggestions);

            const event = press(chipsOf(suggestions)[0] as HTMLElement, key);

            expect(selected).toEqual(["Summarise this"]);
            expect(event.defaultPrevented).toBe(true);
        });

        it("does not select on other keys", async () => {
            const suggestions = await renderSuggestions();
            const selected = collectSelections(suggestions);

            press(chipsOf(suggestions)[0] as HTMLElement, "a");

            expect(selected).toEqual([]);
        });

        it("does not cancel the default action of unrelated keys such as Tab", async () => {
            const suggestions = await renderSuggestions();

            const event = press(chipsOf(suggestions)[0] as HTMLElement, "Tab");

            expect(event.defaultPrevented).toBe(false);
        });

        it("moves focus to the next and previous chip with the arrow keys", async () => {
            const suggestions = await renderSuggestions();
            const [first, second, third] = chipsOf(suggestions);

            first?.focus();
            press(first as HTMLElement, "ArrowRight");
            expect(document.activeElement).toBe(second);

            press(second as HTMLElement, "ArrowDown");
            expect(document.activeElement).toBe(third);

            press(third as HTMLElement, "ArrowLeft");
            expect(document.activeElement).toBe(second);

            press(second as HTMLElement, "ArrowUp");
            expect(document.activeElement).toBe(first);
        });

        it("does not wrap past either end and still prevents default scrolling", async () => {
            const suggestions = await renderSuggestions();
            const [first, , third] = chipsOf(suggestions);

            first?.focus();
            const before = press(first as HTMLElement, "ArrowLeft");
            expect(document.activeElement).toBe(first);
            expect(before.defaultPrevented).toBe(true);

            third?.focus();
            const after = press(third as HTMLElement, "ArrowRight");
            expect(document.activeElement).toBe(third);
            expect(after.defaultPrevented).toBe(true);
        });

        it("does not emit select for arrow navigation", async () => {
            const suggestions = await renderSuggestions();
            const selected = collectSelections(suggestions);

            press(chipsOf(suggestions)[0] as HTMLElement, "ArrowRight");

            expect(selected).toEqual([]);
        });
    });

    describe("native key handling", () => {
        it("does not cancel Shift+Tab, printable keys or Escape", async () => {
            const suggestions = await renderSuggestions();
            const chip = chipsOf(suggestions)[0] as HTMLElement;

            for (const key of ["Tab", "x", "Escape", "Home"]) {
                expect(press(chip, key).defaultPrevented, key).toBe(false);
            }
        });

        it("still cancels the keys it handles", async () => {
            const suggestions = await renderSuggestions();
            const chip = chipsOf(suggestions)[0] as HTMLElement;

            for (const key of ["Enter", " ", "ArrowRight", "ArrowLeft"]) {
                expect(press(chip, key).defaultPrevented, key).toBe(true);
            }
        });
    });
});
