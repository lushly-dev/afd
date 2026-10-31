import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-text-field";
import type { VioletTextField } from "./violet-text-field";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
}

async function renderField(
    options: {
        configure?: (field: VioletTextField) => void;
        inForm?: boolean;
    } = {}
): Promise<{ field: VioletTextField; form: HTMLFormElement | null }> {
    document.body.innerHTML = "";

    const field = document.createElement("violet-text-field") as VioletTextField;
    field.name = "amount";
    options.configure?.(field);

    let form: HTMLFormElement | null = null;
    if (options.inForm) {
        form = document.createElement("form");
        form.append(field);
        document.body.append(form);
    } else {
        document.body.append(field);
    }

    await customElements.whenDefined("violet-text-field");
    await settle();

    return { field, form };
}

function input(field: VioletTextField): HTMLInputElement {
    const native = field.shadowRoot?.querySelector("input");
    if (!native) {
        throw new Error("violet-text-field did not render its native input");
    }
    return native;
}

describe("violet-text-field native constraints", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("forwards min, max, step, minlength, maxlength, pattern and autocomplete to the input", async () => {
        const { field } = await renderField({
            configure: el => {
                el.setAttribute("type", "number");
                el.setAttribute("min", "2");
                el.setAttribute("max", "10");
                el.setAttribute("step", "2");
                el.setAttribute("minlength", "1");
                el.setAttribute("maxlength", "4");
                el.setAttribute("pattern", "[0-9]+");
                el.setAttribute("autocomplete", "off");
            },
        });
        const native = input(field);

        expect(native.type).toBe("number");
        expect(native.getAttribute("min")).toBe("2");
        expect(native.getAttribute("max")).toBe("10");
        expect(native.getAttribute("step")).toBe("2");
        expect(native.getAttribute("minlength")).toBe("1");
        expect(native.getAttribute("maxlength")).toBe("4");
        expect(native.getAttribute("pattern")).toBe("[0-9]+");
        expect(native.getAttribute("autocomplete")).toBe("off");
        expect(field.minLength).toBe(1);
        expect(field.maxLength).toBe(4);
    });

    it("forwards inputmode to the input, from the attribute or the property", async () => {
        const { field } = await renderField({
            configure: el => {
                el.setAttribute("inputmode", "numeric");
            },
        });
        const native = input(field);
        expect(native.getAttribute("inputmode")).toBe("numeric");

        field.inputMode = "decimal";
        await nextFrame();
        expect(native.getAttribute("inputmode")).toBe("decimal");
        expect(field.getAttribute("inputmode")).toBe("decimal");

        field.removeAttribute("inputmode");
        await nextFrame();
        expect(native.hasAttribute("inputmode")).toBe(false);
    });

    it("omits the attributes when unset and removes them when cleared", async () => {
        const { field } = await renderField();
        const native = input(field);

        for (const name of ["min", "max", "step", "minlength", "maxlength", "pattern", "autocomplete", "inputmode"]) {
            expect(native.hasAttribute(name)).toBe(false);
        }

        field.setAttribute("maxlength", "3");
        field.setAttribute("min", "1");
        await nextFrame();
        expect(native.getAttribute("maxlength")).toBe("3");
        expect(native.getAttribute("min")).toBe("1");

        field.removeAttribute("maxlength");
        field.removeAttribute("min");
        await nextFrame();
        expect(native.hasAttribute("maxlength")).toBe(false);
        expect(native.hasAttribute("min")).toBe(false);
    });

    it("supports the date type", async () => {
        const { field } = await renderField({
            configure: el => {
                el.type = "date";
            },
        });

        expect(input(field).type).toBe("date");
    });

    it("reports range violations through ElementInternals and blocks submission", async () => {
        const { field, form } = await renderField({
            inForm: true,
            configure: el => {
                el.type = "number";
                el.min = "5";
                el.max = "10";
                el.value = "3";
            },
        });
        const formEl = form as HTMLFormElement;

        expect(field.validity.rangeUnderflow).toBe(true);
        expect(field.validity.valid).toBe(false);
        expect(field.validationMessage).toBe(input(field).validationMessage);
        expect(field.validationMessage).not.toBe("");
        expect(formEl.checkValidity()).toBe(false);

        let submitted = false;
        formEl.addEventListener("submit", event => {
            event.preventDefault();
            submitted = true;
        });
        formEl.requestSubmit();
        expect(submitted).toBe(false);

        field.value = "11";
        await settle();
        expect(field.validity.rangeOverflow).toBe(true);
        expect(field.validity.rangeUnderflow).toBe(false);

        field.value = "7";
        await settle();
        expect(field.checkValidity()).toBe(true);
        expect(field.validationMessage).toBe("");
        formEl.requestSubmit();
        expect(submitted).toBe(true);
    });

    it("reports stepMismatch", async () => {
        const { field } = await renderField({
            configure: el => {
                el.type = "number";
                el.min = "0";
                el.step = "5";
                el.value = "7";
            },
        });

        expect(field.validity.stepMismatch).toBe(true);
        expect(field.checkValidity()).toBe(false);
    });

    it("reports tooShort for user-entered text under minlength", async () => {
        const { field } = await renderField({
            configure: el => {
                el.minLength = 5;
            },
        });

        field.focus();
        await userEvent.keyboard("abc");
        await settle();

        expect(field.value).toBe("abc");
        expect(field.validity.tooShort).toBe(true);
        expect(field.checkValidity()).toBe(false);

        await userEvent.keyboard("de");
        await settle();
        expect(field.validity.tooShort).toBe(false);
        expect(field.checkValidity()).toBe(true);
    });

    it("caps typed text at maxlength", async () => {
        const { field } = await renderField({
            configure: el => {
                el.maxLength = 3;
            },
        });

        field.focus();
        await userEvent.keyboard("abcdef");
        await settle();

        expect(field.value).toBe("abc");
    });

    it("reports tooLong for a programmatic value over maxlength", async () => {
        const { field } = await renderField({
            configure: el => {
                el.maxLength = 3;
                el.value = "abcdef";
            },
        });

        expect(field.validity.tooLong).toBe(true);
        expect(field.validationMessage).not.toBe("");
    });

    it("reports patternMismatch and typeMismatch", async () => {
        const { field } = await renderField({
            configure: el => {
                el.pattern = "[0-9]+";
                el.value = "abc";
            },
        });
        expect(field.validity.patternMismatch).toBe(true);

        field.pattern = "";
        field.type = "email";
        field.value = "not-an-email";
        await settle();
        expect(field.validity.typeMismatch).toBe(true);
        expect(field.validity.patternMismatch).toBe(false);
    });

    it("keeps invalid and required ahead of native validity", async () => {
        const { field } = await renderField({
            configure: el => {
                el.type = "number";
                el.min = "5";
                el.value = "3";
                el.invalid = true;
            },
        });

        expect(field.validity.customError).toBe(true);
        expect(field.validationMessage).toBe("Please correct this field.");

        field.invalid = false;
        field.required = true;
        field.value = "";
        await settle();
        expect(field.validity.valueMissing).toBe(true);
        expect(field.validationMessage).toBe("Please fill out this field.");
    });

    it("is barred from constraint validation while readonly", async () => {
        const { field } = await renderField({
            configure: el => {
                el.type = "number";
                el.min = "5";
                el.value = "3";
                el.readonly = true;
            },
        });

        expect(field.checkValidity()).toBe(true);
    });

    it("anchors the validity message to the inner input", async () => {
        const { field } = await renderField({
            inForm: true,
            configure: el => {
                el.type = "number";
                el.min = "5";
                el.value = "3";
            },
        });

        expect(field.reportValidity()).toBe(false);
        expect(field.shadowRoot?.activeElement).toBe(input(field));
    });
});

describe("violet-text-field aria-describedby", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function describedBy(field: VioletTextField): Element[] {
        return Array.from(input(field).ariaDescribedByElements ?? []);
    }

    it("links supporting text to the input", async () => {
        const { field } = await renderField({
            configure: el => {
                el.supportingText = "We never share it.";
            },
        });
        const supporting = field.shadowRoot?.querySelector(".supporting") as HTMLElement;

        expect(supporting.id).not.toBe("");
        expect(describedBy(field)).toEqual([supporting]);
    });

    it("drops the link when supporting text is removed", async () => {
        const { field } = await renderField({
            configure: el => {
                el.supportingText = "Help";
            },
        });
        expect(describedBy(field)).toHaveLength(1);

        field.supportingText = "";
        await settle();

        expect(describedBy(field)).toHaveLength(0);
        expect(input(field).hasAttribute("aria-describedby")).toBe(false);
    });

    it("resolves a host aria-describedby from the light DOM ahead of supporting text", async () => {
        document.body.innerHTML = "";
        const hint = document.createElement("p");
        hint.id = "external-hint";
        hint.textContent = "Outside hint";
        const field = document.createElement("violet-text-field") as VioletTextField;
        field.setAttribute("aria-describedby", "external-hint");
        field.supportingText = "Inside help";
        document.body.append(hint, field);
        await settle();

        const supporting = field.shadowRoot?.querySelector(".supporting");
        expect(describedBy(field)).toEqual([hint, supporting]);
    });

    it("re-resolves when the host attribute changes and when focus arrives", async () => {
        document.body.innerHTML = "";
        const first = document.createElement("p");
        first.id = "hint-a";
        const field = document.createElement("violet-text-field") as VioletTextField;
        field.setAttribute("aria-describedby", "hint-a hint-late");
        document.body.append(first, field);
        await settle();
        expect(describedBy(field)).toEqual([first]);

        const late = document.createElement("p");
        late.id = "hint-late";
        document.body.append(late);
        field.focus();
        await settle();
        expect(describedBy(field)).toEqual([first, late]);

        field.setAttribute("aria-describedby", "hint-late");
        await settle();
        expect(describedBy(field)).toEqual([late]);
    });

    it("resolves ids in the host's own shadow root", async () => {
        document.body.innerHTML = "";
        const outer = document.createElement("div");
        const root = outer.attachShadow({ mode: "open" });
        const hint = document.createElement("span");
        hint.id = "scoped-hint";
        const field = document.createElement("violet-text-field") as VioletTextField;
        field.setAttribute("aria-describedby", "scoped-hint");
        root.append(hint, field);
        document.body.append(outer);
        await settle();

        expect(describedBy(field)).toEqual([hint]);
    });

    it("falls back to an IDREF to the supporting text without element reflection", async () => {
        const proto = Element.prototype as unknown as Record<string, unknown>;
        const descriptor = Object.getOwnPropertyDescriptor(proto, "ariaDescribedByElements");
        expect(descriptor).toBeDefined();
        if (!descriptor) {
            return;
        }

        // Simulate a browser without element reflection.
        Reflect.deleteProperty(proto, "ariaDescribedByElements");
        try {
            document.body.innerHTML = "";
            const field = document.createElement("violet-text-field") as VioletTextField;
            field.setAttribute("aria-describedby", "ignored-light-dom");
            field.supportingText = "Inside help";
            document.body.append(field);
            await settle();

            const supporting = field.shadowRoot?.querySelector(".supporting") as HTMLElement;
            expect(input(field).getAttribute("aria-describedby")).toBe(supporting.id);
        } finally {
            Object.defineProperty(proto, "ariaDescribedByElements", descriptor);
        }
    });
});
