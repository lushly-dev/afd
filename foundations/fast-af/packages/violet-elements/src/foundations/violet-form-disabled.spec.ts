import { afterEach, describe, expect, it } from "vitest";

import "../checkbox/violet-checkbox";
import "../color-picker/violet-color-picker";
import "../combobox/violet-combobox";
import "../date-picker/violet-date-picker";
import "../file-upload/violet-file-upload";
import "../radio-group/violet-radio-group";
import "../radio/violet-radio";
import "../segment/violet-segment";
import "../segmented-control/violet-segmented-control";
import "../select/violet-select";
import "../slider/violet-range-slider";
import "../slider/violet-slider";
import "../switch/violet-switch";
import "../text-area/violet-text-area";
import "../text-field/violet-text-field";
import "../time-picker/violet-time-picker";
import { isDisabledByFieldset } from "./violet-form-disabled";

type FormDisabledElement = HTMLElement & {
    disabled: boolean;
    fieldsetDisabled: boolean;
    effectiveDisabled: boolean;
};

interface Family {
    tag: string;
    /** Selector for a native control inside the shadow root that must reflect the disabled state. */
    inner?: string;
    children?: string;
}

const families: Family[] = [
    { tag: "violet-text-field", inner: "input" },
    { tag: "violet-text-area", inner: "textarea" },
    { tag: "violet-checkbox", inner: "input" },
    { tag: "violet-switch", inner: "input" },
    { tag: "violet-select", inner: ".trigger" },
    { tag: "violet-combobox", inner: "input" },
    { tag: "violet-slider", inner: "input" },
    { tag: "violet-range-slider", inner: "input" },
    { tag: "violet-radio-group", children: '<violet-radio value="a">A</violet-radio><violet-radio value="b">B</violet-radio>' },
    { tag: "violet-date-picker", inner: "input" },
    { tag: "violet-time-picker", inner: "input" },
    {
        tag: "violet-segmented-control",
        children: '<violet-segment value="a">A</violet-segment><violet-segment value="b">B</violet-segment>',
    },
    { tag: "violet-file-upload", inner: "input" },
    { tag: "violet-color-picker", inner: ".trigger" },
];

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
}

async function mount(family: Family, fieldsetDisabled: boolean, ownDisabled = false) {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = fieldsetDisabled;
    const element = document.createElement(family.tag) as FormDisabledElement;
    element.setAttribute("name", "field");
    element.setAttribute("aria-label", "Field");
    if (ownDisabled) {
        element.setAttribute("disabled", "");
    }
    if (family.children) {
        element.innerHTML = family.children;
    }
    fieldset.append(element);
    form.append(fieldset);
    document.body.append(form);
    await customElements.whenDefined(family.tag);
    await settle();
    return { form, fieldset, element };
}

function innerDisabled(element: HTMLElement, family: Family): boolean | undefined {
    if (!family.inner) {
        return undefined;
    }

    const inner = element.shadowRoot?.querySelector(family.inner) as
        | (HTMLElement & { disabled?: boolean })
        | null;

    if (!inner) {
        throw new Error(`Expected ${family.tag} to render ${family.inner}.`);
    }

    return Boolean(inner.disabled);
}

describe("form-associated components inside <fieldset disabled>", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    for (const family of families) {
        describe(family.tag, () => {
            it("is disabled by an ancestor fieldset without touching its own disabled state", async () => {
                const { element } = await mount(family, true);

                expect(element.matches(":disabled")).toBe(true);
                expect(element.fieldsetDisabled).toBe(true);
                expect(element.effectiveDisabled).toBe(true);
                expect(element.disabled).toBe(false);
                expect(element.hasAttribute("disabled")).toBe(false);

                if (family.inner) {
                    expect(innerDisabled(element, family)).toBe(true);
                }

                for (const child of Array.from(element.children)) {
                    const effective = (child as FormDisabledElement).effectiveDisabled;
                    expect(effective).toBe(true);
                }
            });

            it("re-enables when the fieldset is enabled again", async () => {
                const { element, fieldset } = await mount(family, true);

                fieldset.disabled = false;
                await settle();

                expect(element.fieldsetDisabled).toBe(false);
                expect(element.effectiveDisabled).toBe(false);

                if (family.inner) {
                    expect(innerDisabled(element, family)).toBe(false);
                }

                for (const child of Array.from(element.children)) {
                    expect((child as FormDisabledElement).effectiveDisabled).toBe(false);
                }
            });

            it("keeps the author disabled attribute when the fieldset toggles", async () => {
                const { element, fieldset } = await mount(family, true, true);

                expect(element.effectiveDisabled).toBe(true);

                fieldset.disabled = false;
                await settle();

                expect(element.hasAttribute("disabled")).toBe(true);
                expect(element.disabled).toBe(true);
                expect(element.effectiveDisabled).toBe(true);

                if (family.inner) {
                    expect(innerDisabled(element, family)).toBe(true);
                }
            });

            it("stays disabled when the author disabled attribute is removed inside a disabled fieldset", async () => {
                const { element } = await mount(family, true, true);

                element.removeAttribute("disabled");
                await settle();

                expect(element.disabled).toBe(false);
                expect(element.effectiveDisabled).toBe(true);

                if (family.inner) {
                    expect(innerDisabled(element, family)).toBe(true);
                }
            });
        });
    }

    it("exempts controls inside the first legend of a disabled fieldset", async () => {
        document.body.innerHTML = `
            <fieldset id="outer" disabled>
                <legend><violet-text-field id="in-legend" label="Legend"></violet-text-field></legend>
                <violet-text-field id="in-body" label="Body"></violet-text-field>
            </fieldset>`;
        await settle();

        const inLegend = document.getElementById("in-legend") as FormDisabledElement;
        const inBody = document.getElementById("in-body") as FormDisabledElement;

        expect(isDisabledByFieldset(inLegend)).toBe(false);
        expect(inLegend.effectiveDisabled).toBe(false);
        expect(isDisabledByFieldset(inBody)).toBe(true);
        expect(inBody.effectiveDisabled).toBe(true);
    });

    describe("formStateRestoreCallback", () => {
        const stringValued: Array<[string, string]> = [
            ["violet-text-field", "restored"],
            ["violet-text-area", "restored"],
            ["violet-slider", "40"],
            ["violet-date-picker", "2026-02-03"],
            ["violet-time-picker", "09:30"],
            ["violet-color-picker", "#336699"],
        ];

        for (const [tag, state] of stringValued) {
            it(`${tag} restores its string value`, async () => {
                const { element } = await mount({ tag }, false);

                (element as unknown as { formStateRestoreCallback(state: string): void }).formStateRestoreCallback(state);

                expect((element as unknown as { value: string }).value).toBe(state);
            });
        }

        for (const tag of ["violet-checkbox", "violet-switch"]) {
            it(`${tag} restores its checked state`, async () => {
                const { element } = await mount({ tag }, false);
                const restore = (element as unknown as { formStateRestoreCallback(state: string): void }).formStateRestoreCallback.bind(element);

                restore("checked");
                expect((element as unknown as { checked: boolean }).checked).toBe(true);

                restore("unchecked");
                expect((element as unknown as { checked: boolean }).checked).toBe(false);
            });
        }
    });

    it("excludes a fieldset-disabled control from form submission", async () => {
        const { form, fieldset, element } = await mount({ tag: "violet-text-field", inner: "input" }, false);
        (element as unknown as { value: string }).value = "kept";
        await settle();

        expect(new FormData(form).get("field")).toBe("kept");

        fieldset.disabled = true;
        await settle();

        expect(new FormData(form).has("field")).toBe(false);
    });
});
