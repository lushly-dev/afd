import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-text-area";
import type { VioletTextArea } from "./violet-text-area";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderArea(
    options: {
        configure?: (area: VioletTextArea) => void;
        inForm?: boolean;
    } = {}
): Promise<{ area: VioletTextArea; form: HTMLFormElement | null }> {
    document.body.innerHTML = "";

    const area = document.createElement("violet-text-area") as VioletTextArea;
    area.name = "notes";
    options.configure?.(area);

    let form: HTMLFormElement | null = null;
    if (options.inForm) {
        form = document.createElement("form");
        form.append(area);
        document.body.append(form);
    } else {
        document.body.append(area);
    }

    await customElements.whenDefined("violet-text-area");
    await nextFrame();

    return { area, form };
}

function textarea(area: VioletTextArea): HTMLTextAreaElement {
    const native = area.shadowRoot?.querySelector("textarea");
    if (!native) {
        throw new Error("violet-text-area did not render its native textarea");
    }
    return native;
}

function customDetails(events: Event[]): Array<{ value: string }> {
    return events
        .filter((event): event is CustomEvent<{ value: string }> => event instanceof CustomEvent)
        .map(event => event.detail);
}

describe("violet-text-area", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders an empty textarea with defaults", async () => {
        const { area } = await renderArea();

        expect(area.rows).toBe(4);
        expect(area.value).toBe("");
        expect(area.disabled).toBe(false);
        expect(area.readonly).toBe(false);
        expect(area.required).toBe(false);
        expect(textarea(area).rows).toBe(4);
        expect(textarea(area).value).toBe("");
        expect(area.shadowRoot?.querySelector("label")).toBeNull();
        expect(area.shadowRoot?.querySelector(".supporting")).toBeNull();
    });

    it("maps attributes to properties and the native textarea", async () => {
        const { area } = await renderArea({
            configure: el => {
                el.setAttribute("value", "Hello\nworld");
                el.setAttribute("placeholder", "Write something");
                el.setAttribute("rows", "7");
                el.setAttribute("name", "comments");
                el.setAttribute("required", "");
                el.setAttribute("readonly", "");
            },
        });
        const native = textarea(area);

        expect(area.value).toBe("Hello\nworld");
        expect(area.rows).toBe(7);
        expect(native.value).toBe("Hello\nworld");
        expect(native.placeholder).toBe("Write something");
        expect(native.rows).toBe(7);
        expect(native.name).toBe("comments");
        expect(native.required).toBe(true);
        expect(native.readOnly).toBe(true);
    });

    it.each(["0", "-3", "abc"])("falls back to 4 rows for invalid rows attribute %j", async rows => {
        const { area } = await renderArea({
            configure: el => {
                el.setAttribute("rows", rows);
            },
        });

        expect(area.rows).toBe(4);
        expect(textarea(area).rows).toBe(4);
    });

    it("reflects boolean properties to host attributes, never value", async () => {
        const { area } = await renderArea();

        area.value = "draft";
        area.rows = 9;
        area.disabled = true;
        area.invalid = true;
        await nextFrame();

        expect(area.hasAttribute("value")).toBe(false);
        expect(area.getAttribute("rows")).toBe("9");
        expect(area.hasAttribute("disabled")).toBe(true);
        expect(area.hasAttribute("invalid")).toBe(true);
        expect(textarea(area).value).toBe("draft");
        expect(textarea(area).rows).toBe(9);
        expect(textarea(area).disabled).toBe(true);
        expect(textarea(area).getAttribute("aria-invalid")).toBe("true");

        area.invalid = false;
        await nextFrame();
        expect(textarea(area).getAttribute("aria-invalid")).toBe("false");
    });

    it("renders a label associated with the textarea", async () => {
        const { area } = await renderArea({
            configure: el => {
                el.label = "Notes";
            },
        });
        const label = area.shadowRoot?.querySelector("label") as HTMLLabelElement;

        expect(label.textContent?.trim()).toBe("Notes");
        expect(label.htmlFor).toBe(textarea(area).id);
        expect(textarea(area).id).toBe(area.inputId);
    });

    it("renders supporting text only when provided", async () => {
        const { area } = await renderArea({
            configure: el => {
                el.supportingText = "Markdown is supported.";
            },
        });

        expect(area.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe("Markdown is supported.");
    });

    it("describes the textarea with its supporting text", async () => {
        const { area } = await renderArea({
            configure: el => {
                el.label = "Notes";
                el.supportingText = "Notes must be under 2000 characters.";
                el.invalid = true;
            },
        });
        const native = textarea(area);
        const describedBy = native.getAttribute("aria-describedby");

        expect(describedBy).toBeTruthy();
        expect(area.shadowRoot?.getElementById(describedBy ?? "")?.textContent?.trim()).toBe(
            "Notes must be under 2000 characters.",
        );
        await expect.element(native).toHaveAccessibleDescription("Notes must be under 2000 characters.");

        area.supportingText = "Write a shorter note.";
        await nextFrame();
        await expect.element(native).toHaveAccessibleDescription("Write a shorter note.");

        area.supportingText = "";
        await nextFrame();
        expect(native.hasAttribute("aria-describedby")).toBe(false);
    });

    it("has no description without supporting text", async () => {
        const { area } = await renderArea();

        expect(textarea(area).hasAttribute("aria-describedby")).toBe(false);
    });

    it("gives each area a unique input id", () => {
        const first = document.createElement("violet-text-area") as VioletTextArea;
        const second = document.createElement("violet-text-area") as VioletTextArea;

        expect(first.inputId).not.toBe(second.inputId);
    });

    it("projects the before slot", async () => {
        const { area } = await renderArea({
            configure: el => {
                const icon = document.createElement("span");
                icon.slot = "before";
                el.append(icon);
            },
        });
        const slot = area.shadowRoot?.querySelector('slot[name="before"]') as HTMLSlotElement;

        expect(slot.assignedElements()).toHaveLength(1);
    });

    describe("interaction", () => {
        it("updates value and emits input events with a value detail while typing", async () => {
            const { area } = await renderArea();
            const events: Event[] = [];
            area.addEventListener("input", event => events.push(event));

            area.focus();
            await userEvent.keyboard("ab");

            expect(area.value).toBe("ab");
            expect(customDetails(events)).toEqual([{ value: "a" }, { value: "ab" }]);
        });

        it("accepts newlines with Enter instead of committing", async () => {
            const { area } = await renderArea();
            const changes: Event[] = [];
            area.addEventListener("change", event => changes.push(event));

            area.focus();
            await userEvent.keyboard("one{Enter}two");

            expect(area.value).toBe("one\ntwo");
            expect(customDetails(changes)).toEqual([]);
        });

        it("emits change with the committed value when focus leaves", async () => {
            const { area } = await renderArea();
            const events: Event[] = [];
            area.addEventListener("change", event => events.push(event));

            area.focus();
            await userEvent.keyboard("done");
            await userEvent.tab();

            expect(customDetails(events)).toEqual([{ value: "done" }]);
        });

        it("forwards maxlength to the native textarea and stops typing at the limit", async () => {
            const { area } = await renderArea({
                configure: el => el.setAttribute("maxlength", "5"),
            });

            expect(area.maxLength).toBe(5);
            expect(textarea(area).maxLength).toBe(5);

            area.focus();
            await userEvent.keyboard("abcdefgh");
            expect(area.value).toBe("abcde");

            area.removeAttribute("maxlength");
            await nextFrame();
            expect(area.maxLength).toBeNull();
            expect(textarea(area).hasAttribute("maxlength")).toBe(false);
        });

        it("ignores typing while readonly", async () => {
            const { area } = await renderArea({
                configure: el => {
                    el.value = "fixed";
                    el.readonly = true;
                },
            });

            area.focus();
            await userEvent.keyboard("zzz");

            expect(area.value).toBe("fixed");
        });

        it("cannot be focused while disabled", async () => {
            const { area } = await renderArea({
                configure: el => {
                    el.disabled = true;
                },
            });

            area.focus();

            expect(area.shadowRoot?.activeElement).toBeNull();
        });

        it("delegates focus to the native textarea", async () => {
            const { area } = await renderArea();

            area.focus();

            expect(document.activeElement).toBe(area);
            expect(area.shadowRoot?.activeElement).toBe(textarea(area));
        });
    });

    describe("form participation", () => {
        it("submits the current value under its name", async () => {
            const { area, form } = await renderArea({ inForm: true });

            expect(new FormData(form as HTMLFormElement).get("notes")).toBe("");

            area.focus();
            await userEvent.keyboard("line1{Enter}line2");

            expect(new FormData(form as HTMLFormElement).get("notes")).toBe("line1\nline2");
            expect(area.form).toBe(form);
        });

        it("omits the value from form data when disabled", async () => {
            const { form } = await renderArea({
                inForm: true,
                configure: el => {
                    el.value = "secret";
                    el.disabled = true;
                },
            });

            expect(new FormData(form as HTMLFormElement).has("notes")).toBe(false);
        });

        it("reports valueMissing while required and empty", async () => {
            const { area, form } = await renderArea({
                inForm: true,
                configure: el => {
                    el.required = true;
                },
            });

            expect(area.checkValidity()).toBe(false);
            expect(area.validity.valueMissing).toBe(true);
            expect(area.validationMessage).not.toBe("");
            expect((form as HTMLFormElement).checkValidity()).toBe(false);

            area.value = "filled";
            await nextFrame();

            expect(area.checkValidity()).toBe(true);
            expect((form as HTMLFormElement).checkValidity()).toBe(true);
        });

        it("reports a custom error while invalid", async () => {
            const { area } = await renderArea({
                inForm: true,
                configure: el => {
                    el.invalid = true;
                },
            });

            expect(area.validity.customError).toBe(true);
            expect(area.checkValidity()).toBe(false);

            area.invalid = false;
            await nextFrame();

            expect(area.checkValidity()).toBe(true);
        });

        it("skips validation while readonly or disabled", async () => {
            const { area } = await renderArea({
                inForm: true,
                configure: el => {
                    el.required = true;
                    el.readonly = true;
                },
            });

            expect(area.checkValidity()).toBe(true);

            area.readonly = false;
            area.disabled = true;
            await nextFrame();

            expect(area.checkValidity()).toBe(true);
        });

        it("restores its initial value on form reset", async () => {
            const { area, form } = await renderArea({
                inForm: true,
                configure: el => {
                    el.setAttribute("value", "initial");
                },
            });

            area.focus();
            await userEvent.keyboard("-edited");
            expect(area.value).toBe("initial-edited");

            (form as HTMLFormElement).reset();
            await nextFrame();

            expect(area.value).toBe("initial");
            expect(textarea(area).value).toBe("initial");
            expect(new FormData(form as HTMLFormElement).get("notes")).toBe("initial");
        });
    });
});

async function renderTextArea(attributes: Record<string, string> = {}): Promise<VioletTextArea> {
    document.body.innerHTML = "";
    const area = document.createElement("violet-text-area") as VioletTextArea;
    area.label = "Notes";
    for (const [name, value] of Object.entries(attributes)) {
        area.setAttribute(name, value);
    }
    document.body.append(area);
    await customElements.whenDefined("violet-text-area");
    await nextFrame();
    return area;
}

function type(area: VioletTextArea, text: string): void {
    const textarea = area.shadowRoot?.querySelector("textarea");
    if (!textarea) {
        throw new Error("Expected textarea to render.");
    }
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

describe("violet-text-area value attribute", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("does not reflect typed text into the value attribute", async () => {
        const area = await renderTextArea();

        type(area, "private draft");
        await nextFrame();

        expect(area.value).toBe("private draft");
        expect(area.hasAttribute("value")).toBe(false);
    });

    it("keeps the initial attribute as the form reset default, including after re-attaching", async () => {
        const area = await renderTextArea({ value: "initial" });
        expect(area.value).toBe("initial");

        type(area, "typed");
        area.remove();
        document.body.append(area);
        await nextFrame();

        area.formResetCallback();
        await nextFrame();

        expect(area.value).toBe("initial");
        expect(area.getAttribute("value")).toBe("initial");
    });
});
