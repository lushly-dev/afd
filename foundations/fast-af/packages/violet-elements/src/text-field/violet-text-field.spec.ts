import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-text-field";
import type { VioletTextField } from "./violet-text-field";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderField(
    options: {
        configure?: (field: VioletTextField) => void;
        inForm?: boolean;
    } = {}
): Promise<{ field: VioletTextField; form: HTMLFormElement | null }> {
    document.body.innerHTML = "";

    const field = document.createElement("violet-text-field") as VioletTextField;
    field.name = "email";
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
    await nextFrame();

    return { field, form };
}

function input(field: VioletTextField): HTMLInputElement {
    const native = field.shadowRoot?.querySelector("input");
    if (!native) {
        throw new Error("violet-text-field did not render its native input");
    }
    return native;
}

function customDetails(events: Event[]): Array<{ value: string }> {
    return events
        .filter((event): event is CustomEvent<{ value: string }> => event instanceof CustomEvent)
        .map(event => event.detail);
}

describe("violet-text-field", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders an empty text input with defaults", async () => {
        const { field } = await renderField();

        expect(field.type).toBe("text");
        expect(field.value).toBe("");
        expect(field.disabled).toBe(false);
        expect(field.readonly).toBe(false);
        expect(field.required).toBe(false);
        expect(input(field).type).toBe("text");
        expect(input(field).value).toBe("");
        expect(field.shadowRoot?.querySelector("label")).toBeNull();
        expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
    });

    it("maps attributes to properties and the native input", async () => {
        const { field } = await renderField({
            configure: el => {
                el.setAttribute("type", "email");
                el.setAttribute("value", "ada@example.com");
                el.setAttribute("placeholder", "you@example.com");
                el.setAttribute("name", "contact");
                el.setAttribute("required", "");
                el.setAttribute("readonly", "");
            },
        });
        const native = input(field);

        expect(field.type).toBe("email");
        expect(field.value).toBe("ada@example.com");
        expect(native.type).toBe("email");
        expect(native.value).toBe("ada@example.com");
        expect(native.placeholder).toBe("you@example.com");
        expect(native.name).toBe("contact");
        expect(native.required).toBe(true);
        expect(native.readOnly).toBe(true);
    });

    it("reflects boolean properties to host attributes, never value", async () => {
        const { field } = await renderField();

        field.value = "hello";
        field.disabled = true;
        field.invalid = true;
        await nextFrame();

        expect(field.hasAttribute("value")).toBe(false);
        expect(field.hasAttribute("disabled")).toBe(true);
        expect(field.hasAttribute("invalid")).toBe(true);
        expect(input(field).value).toBe("hello");
        expect(input(field).disabled).toBe(true);
        expect(input(field).getAttribute("aria-invalid")).toBe("true");

        field.invalid = false;
        await nextFrame();
        expect(input(field).getAttribute("aria-invalid")).toBe("false");
    });

    it("renders a label associated with the input and uses it as the accessible name", async () => {
        const { field } = await renderField({
            configure: el => {
                el.label = "Email address";
            },
        });
        const label = field.shadowRoot?.querySelector("label") as HTMLLabelElement;

        expect(label.textContent?.trim()).toBe("Email address");
        expect(label.htmlFor).toBe(input(field).id);
        expect(input(field).id).toBe(field.inputId);
        expect(input(field).getAttribute("aria-label")).toBe("Email address");
    });

    it("falls back to the host aria-label when there is no visible label", async () => {
        const { field } = await renderField({
            configure: el => {
                el.setAttribute("aria-label", "Search");
            },
        });

        expect(input(field).getAttribute("aria-label")).toBe("Search");
    });

    it("renders supporting text only when provided", async () => {
        const { field } = await renderField({
            configure: el => {
                el.supportingText = "We never share your email.";
            },
        });

        expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe("We never share your email.");
    });

    it("gives each field a unique input id", async () => {
        const first = document.createElement("violet-text-field") as VioletTextField;
        const second = document.createElement("violet-text-field") as VioletTextField;

        expect(first.inputId).not.toBe(second.inputId);
    });

    it("projects the before slot", async () => {
        const { field } = await renderField({
            configure: el => {
                const icon = document.createElement("span");
                icon.slot = "before";
                icon.textContent = "@";
                el.append(icon);
            },
        });
        const slot = field.shadowRoot?.querySelector('slot[name="before"]') as HTMLSlotElement;

        expect(slot.assignedElements()).toHaveLength(1);
    });

    describe("interaction", () => {
        it("updates value and emits input events with a value detail while typing", async () => {
            const { field } = await renderField();
            const events: Event[] = [];
            field.addEventListener("input", event => events.push(event));

            field.focus();
            await userEvent.keyboard("abc");

            expect(field.value).toBe("abc");
            expect(input(field).value).toBe("abc");
            expect(customDetails(events)).toEqual([{ value: "a" }, { value: "ab" }, { value: "abc" }]);
        });

        it("emits change with the committed value when focus leaves", async () => {
            const { field } = await renderField();
            const events: Event[] = [];
            field.addEventListener("change", event => events.push(event));

            field.focus();
            await userEvent.keyboard("hello");
            expect(customDetails(events)).toEqual([]);

            await userEvent.tab();

            expect(customDetails(events)).toEqual([{ value: "hello" }]);
            expect(field.value).toBe("hello");
        });

        it("emits change on Enter after typing", async () => {
            const { field } = await renderField();
            const events: Event[] = [];
            field.addEventListener("change", event => events.push(event));

            field.focus();
            await userEvent.keyboard("go{Enter}");

            expect(customDetails(events)).toEqual([{ value: "go" }]);
        });

        it("ignores typing while readonly", async () => {
            const { field } = await renderField({
                configure: el => {
                    el.value = "fixed";
                    el.readonly = true;
                },
            });

            field.focus();
            await userEvent.keyboard("zzz");

            expect(field.value).toBe("fixed");
        });

        it("cannot be focused while disabled", async () => {
            const { field } = await renderField({
                configure: el => {
                    el.disabled = true;
                },
            });

            field.focus();

            expect(field.shadowRoot?.activeElement).toBeNull();
        });

        it("delegates focus to the native input", async () => {
            const { field } = await renderField();

            field.focus();

            expect(document.activeElement).toBe(field);
            expect(field.shadowRoot?.activeElement).toBe(input(field));
        });
    });

    describe("form participation", () => {
        it("submits the current value under its name", async () => {
            const { field, form } = await renderField({ inForm: true });

            expect(new FormData(form as HTMLFormElement).get("email")).toBe("");

            field.focus();
            await userEvent.keyboard("ada@example.com");

            expect(new FormData(form as HTMLFormElement).get("email")).toBe("ada@example.com");
            expect(field.form).toBe(form);
        });

        it("submits the initial value attribute", async () => {
            const { form } = await renderField({
                inForm: true,
                configure: el => {
                    el.setAttribute("value", "preset");
                },
            });

            expect(new FormData(form as HTMLFormElement).get("email")).toBe("preset");
        });

        it("omits the value from form data when disabled", async () => {
            const { form } = await renderField({
                inForm: true,
                configure: el => {
                    el.value = "secret";
                    el.disabled = true;
                },
            });

            expect(new FormData(form as HTMLFormElement).has("email")).toBe(false);
        });

        it("reports valueMissing while required and empty", async () => {
            const { field, form } = await renderField({
                inForm: true,
                configure: el => {
                    el.required = true;
                },
            });

            expect(field.checkValidity()).toBe(false);
            expect(field.validity.valueMissing).toBe(true);
            expect(field.validationMessage).not.toBe("");
            expect((form as HTMLFormElement).checkValidity()).toBe(false);

            field.value = "filled";
            await nextFrame();

            expect(field.checkValidity()).toBe(true);
            expect((form as HTMLFormElement).checkValidity()).toBe(true);
        });

        it("reports a custom error while invalid", async () => {
            const { field } = await renderField({
                inForm: true,
                configure: el => {
                    el.value = "nope";
                    el.invalid = true;
                },
            });

            expect(field.validity.customError).toBe(true);
            expect(field.checkValidity()).toBe(false);

            field.invalid = false;
            await nextFrame();

            expect(field.checkValidity()).toBe(true);
        });

        it("skips validation while readonly or disabled", async () => {
            const { field } = await renderField({
                inForm: true,
                configure: el => {
                    el.required = true;
                    el.readonly = true;
                },
            });

            expect(field.checkValidity()).toBe(true);

            field.readonly = false;
            field.disabled = true;
            await nextFrame();

            expect(field.checkValidity()).toBe(true);
        });

        it("restores its initial value on form reset", async () => {
            const { field, form } = await renderField({
                inForm: true,
                configure: el => {
                    el.setAttribute("value", "initial");
                },
            });

            field.focus();
            // Keyboard-style focus selects the existing text; collapse the selection to the end first.
            input(field).setSelectionRange(7, 7);
            await userEvent.keyboard("-edited");
            expect(field.value).toBe("initial-edited");

            (form as HTMLFormElement).reset();
            await nextFrame();

            expect(field.value).toBe("initial");
            expect(input(field).value).toBe("initial");
            expect(new FormData(form as HTMLFormElement).get("email")).toBe("initial");
        });

        it("resets to empty when no initial value was provided", async () => {
            const { field, form } = await renderField({ inForm: true });

            field.value = "typed";
            await nextFrame();
            (form as HTMLFormElement).reset();
            await nextFrame();

            expect(field.value).toBe("");
        });
    });
});

async function renderTextField(attributes: Record<string, string> = {}): Promise<VioletTextField> {
    document.body.innerHTML = "";
    const field = document.createElement("violet-text-field") as VioletTextField;
    field.label = "Password";
    for (const [name, value] of Object.entries(attributes)) {
        field.setAttribute(name, value);
    }
    document.body.append(field);
    await customElements.whenDefined("violet-text-field");
    await nextFrame();
    return field;
}

function type(field: VioletTextField, text: string): void {
    const input = field.shadowRoot?.querySelector("input");
    if (!input) {
        throw new Error("Expected text field input to render.");
    }
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

describe("violet-text-field value attribute", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("does not reflect typed text into the value attribute", async () => {
        const field = await renderTextField({ type: "password" });

        type(field, "hunter2");
        await nextFrame();

        expect(field.value).toBe("hunter2");
        expect(field.hasAttribute("value")).toBe(false);
    });

    it("does not reflect programmatic value changes into the attribute", async () => {
        const field = await renderTextField({ value: "initial" });

        field.value = "changed";
        await nextFrame();

        expect(field.getAttribute("value")).toBe("initial");
    });

    it("still reads the initial value attribute and later attribute changes", async () => {
        const field = await renderTextField({ value: "initial" });
        expect(field.value).toBe("initial");

        field.setAttribute("value", "updated");
        await nextFrame();

        expect(field.value).toBe("updated");
    });

    it("resets to the attribute default, including after re-attaching", async () => {
        const field = await renderTextField({ value: "initial" });

        type(field, "typed");
        field.remove();
        document.body.append(field);
        await nextFrame();

        field.formResetCallback();
        await nextFrame();

        expect(field.value).toBe("initial");
        expect(field.getAttribute("value")).toBe("initial");
    });
});
