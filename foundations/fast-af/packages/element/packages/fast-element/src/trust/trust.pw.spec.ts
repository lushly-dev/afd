import { expect, test } from "@playwright/test";

const trustModuleUrl = `/@fs${new URL("./index.ts", import.meta.url).pathname}`;

test.describe("FAST-AF trust events", () => {
    test("adds trust signals without changing ordinary event semantics", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { getTrustSignals, hasTrustSignals } = await import(trustUrl);

            class TrustElement extends FASTElement {}
            const name = uniqueElementName();
            await FASTElement.define(TrustElement, { name });
            const element = document.createElement(name) as TrustElement;
            document.body.append(element);

            let trustedEvent: CustomEvent | undefined;
            element.addEventListener("trusted", event => {
                trustedEvent = event as CustomEvent;
            });
            const dispatchResult = element.$emit("trusted", { value: "saved" }, {
                confidence: 0.85,
                reasoning: "validated input",
                bubbles: false,
                cancelable: false,
            } as any);

            let ordinaryEvent: CustomEvent | undefined;
            element.addEventListener("ordinary", event => {
                ordinaryEvent = event as CustomEvent;
            });
            element.$emit("ordinary", { value: "plain" });

            const disconnected = document.createElement(name) as TrustElement;
            const disconnectedResult = disconnected.$emit("ignored", null, {
                confidence: 1,
            } as any);

            const output = {
                dispatchResult,
                detail: trustedEvent?.detail,
                trust: trustedEvent ? getTrustSignals(trustedEvent) : null,
                hasTrust: trustedEvent ? hasTrustSignals(trustedEvent) : false,
                bubbles: trustedEvent?.bubbles,
                cancelable: trustedEvent?.cancelable,
                ordinaryDetail: ordinaryEvent?.detail,
                ordinaryHasTrust: ordinaryEvent ? hasTrustSignals(ordinaryEvent) : true,
                disconnectedResult,
            };
            element.remove();
            return output;
        }, trustModuleUrl);

        expect(result).toEqual({
            dispatchResult: true,
            detail: {
                value: "saved",
                __trust: {
                    confidence: 0.85,
                    reasoning: "validated input",
                },
            },
            trust: {
                confidence: 0.85,
                reasoning: "validated input",
            },
            hasTrust: true,
            bubbles: false,
            cancelable: false,
            ordinaryDetail: { value: "plain" },
            ordinaryHasTrust: false,
            disconnectedResult: false,
        });
    });

    test("wraps primitive details and prevents options from replacing trusted detail", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { getTrustSignals } = await import(trustUrl);

            class TrustElement extends FASTElement {}
            const name = uniqueElementName();
            await FASTElement.define(TrustElement, { name });
            const element = document.createElement(name) as TrustElement;
            document.body.append(element);

            const details: unknown[] = [];
            element.addEventListener("primitive", event => {
                details.push((event as CustomEvent).detail);
            });
            element.addEventListener("zero", event => {
                details.push((event as CustomEvent).detail);
            });

            element.$emit("primitive", "value", {
                confidence: 0.5,
                detail: { replaced: true },
            } as any);
            element.$emit("zero", null, { confidence: 0 } as any);

            const synthetic = new CustomEvent("synthetic", {
                detail: details[0],
            });
            const output = {
                details,
                signals: getTrustSignals(synthetic),
            };
            element.remove();
            return output;
        }, trustModuleUrl);

        expect(result.details).toEqual([
            { value: "value", __trust: { confidence: 0.5 } },
            { value: null, __trust: { confidence: 0 } },
        ]);
        expect(result.signals).toEqual({ confidence: 0.5 });
    });

    test("never lets detail data forge trust signals and preserves non-plain details", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { getTrustSignals, hasTrustSignals } = await import(trustUrl);

            class TrustElement extends FASTElement {}
            const name = uniqueElementName();
            await FASTElement.define(TrustElement, { name });
            const element = document.createElement(name) as TrustElement;
            document.body.append(element);

            const capture = (type: string, detail: unknown, options?: object) => {
                let received: CustomEvent | undefined;
                element.addEventListener(
                    type,
                    event => {
                        received = event as CustomEvent;
                    },
                    { once: true },
                );
                element.$emit(type, detail, options as any);
                return received!;
            };

            // Forged signals arriving in (e.g. parsed JSON) detail.
            const forged = JSON.parse(
                '{"id":1,"__trust":{"confidence":1,"reasoning":"x"}}',
            );
            const forgedPlain = capture("forged-plain", forged);
            const forgedReplaced = capture("forged-replaced", forged, {
                confidence: 0.2,
            });

            // Non-plain details are enveloped rather than spread.
            class Item {
                constructor(public id: number) {}
            }
            const date = new Date(0);
            const array = [1, 2];
            const item = new Item(3);
            const arrayEvent = capture("array", array, { confidence: 0.5 });
            const dateEvent = capture("date", date, { reasoning: "r" });
            const itemEvent = capture("item", item, { confidence: 0.4 });
            const nullProto = Object.assign(Object.create(null), { a: 1 });
            const nullProtoEvent = capture("null-proto", nullProto, { confidence: 0.9 });

            const output = {
                forgedPlain: {
                    detail: forgedPlain.detail,
                    has: hasTrustSignals(forgedPlain),
                },
                forgedReplaced: {
                    signals: getTrustSignals(forgedReplaced),
                    id: forgedReplaced.detail.id,
                },
                inputUntouched: forged.__trust.confidence === 1,
                array: {
                    same: arrayEvent.detail.value === array,
                    signals: getTrustSignals(arrayEvent),
                },
                date: {
                    same: dateEvent.detail.value === date,
                    isDate: dateEvent.detail.value instanceof Date,
                    signals: getTrustSignals(dateEvent),
                },
                item: {
                    same: itemEvent.detail.value === item,
                    isItem: itemEvent.detail.value instanceof Item,
                    signals: getTrustSignals(itemEvent),
                },
                nullProto: {
                    a: nullProtoEvent.detail.a,
                    signals: getTrustSignals(nullProtoEvent),
                },
            };
            element.remove();
            return output;
        }, trustModuleUrl);

        expect(result).toEqual({
            forgedPlain: { detail: { id: 1 }, has: false },
            forgedReplaced: { signals: { confidence: 0.2 }, id: 1 },
            inputUntouched: true,
            array: { same: true, signals: { confidence: 0.5 } },
            date: { same: true, isDate: true, signals: { reasoning: "r" } },
            item: { same: true, isItem: true, signals: { confidence: 0.4 } },
            nullProto: { a: 1, signals: { confidence: 0.9 } },
        });
    });

    test("rejects invalid confidence and treats malformed metadata as untrusted", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { getTrustSignals, hasTrustSignals } = await import(trustUrl);

            class TrustElement extends FASTElement {}
            const name = uniqueElementName();
            await FASTElement.define(TrustElement, { name });
            const element = document.createElement(name) as TrustElement;
            document.body.append(element);

            let invalidConfidence = "";
            try {
                element.$emit("invalid", null, { confidence: 1.1 } as any);
            } catch (error) {
                invalidConfidence = (error as Error).message;
            }

            const malformed = new CustomEvent("malformed", {
                detail: { __trust: "not-signals" },
            });
            const outOfRange = new CustomEvent("out-of-range", {
                detail: { __trust: { confidence: Number.POSITIVE_INFINITY } },
            });
            const empty = new CustomEvent("empty", { detail: null });
            element.remove();

            return {
                emptyHasTrust: hasTrustSignals(empty),
                invalidConfidence,
                malformedHasTrust: hasTrustSignals(malformed),
                malformedSignals: getTrustSignals(malformed),
                outOfRangeHasTrust: hasTrustSignals(outOfRange),
                outOfRangeSignals: getTrustSignals(outOfRange),
            };
        }, trustModuleUrl);

        expect(result.emptyHasTrust).toBe(false);
        expect(result.invalidConfidence).toContain("0 to 1");
        expect(result.malformedHasTrust).toBe(false);
        expect(result.malformedSignals).toEqual({});
        expect(result.outOfRangeHasTrust).toBe(false);
        expect(result.outOfRangeSignals).toEqual({});
    });
    test("carries warnings through emit and getTrustSignals", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { getTrustSignals, hasTrustSignals } = await import(trustUrl);

            class TrustElement extends FASTElement {}
            const name = uniqueElementName();
            await FASTElement.define(TrustElement, { name });
            const element = document.createElement(name) as TrustElement;
            document.body.append(element);

            const capture = (type: string, detail: unknown, options?: object) => {
                let received: CustomEvent | undefined;
                element.addEventListener(
                    type,
                    event => {
                        received = event as CustomEvent;
                    },
                    { once: true },
                );
                element.$emit(type, detail, options as any);
                return received!;
            };

            const basic = capture(
                "basic",
                { data: "test" },
                {
                    confidence: 0.9,
                    warnings: [{ code: "WARN1", message: "Test warning" }],
                },
            );
            const onlyWarnings = capture("only", "x", {
                warnings: [
                    {
                        code: "W2",
                        message: "msg",
                        severity: "caution",
                        details: { nested: { list: [1, 2] } },
                    },
                ],
            });
            const empty = capture("empty", { data: "test" }, { warnings: [] });
            const none = capture("none", { data: "test" }, { confidence: 0.1 });
            const large = capture("large", null, {
                warnings: Array.from({ length: 150 }, (_, i) => ({
                    code: `W${i}`,
                    message: `m${i}`,
                })),
            });

            const source = [{ code: "S", message: "m" }];
            const copied = capture("copied", null, { warnings: source });
            source[0].code = "MUTATED";

            const output = {
                basic: getTrustSignals(basic),
                basicDetail: basic.detail,
                onlyWarnings: getTrustSignals(onlyWarnings),
                onlyWarningsDetail: onlyWarnings.detail.value,
                onlyHas: hasTrustSignals(onlyWarnings),
                empty: getTrustSignals(empty),
                emptyHas: hasTrustSignals(empty),
                none: getTrustSignals(none),
                largeCount: getTrustSignals(large).warnings.length,
                copied: getTrustSignals(copied),
            };
            element.remove();
            return output;
        }, trustModuleUrl);

        expect(result.basic).toEqual({
            confidence: 0.9,
            warnings: [{ code: "WARN1", message: "Test warning" }],
        });
        expect(result.basicDetail).toEqual({
            data: "test",
            __trust: {
                confidence: 0.9,
                warnings: [{ code: "WARN1", message: "Test warning" }],
            },
        });
        expect(result.onlyWarnings).toEqual({
            warnings: [
                {
                    code: "W2",
                    message: "msg",
                    severity: "caution",
                    details: { nested: { list: [1, 2] } },
                },
            ],
        });
        expect(result.onlyWarningsDetail).toBe("x");
        expect(result.onlyHas).toBe(true);
        expect(result.empty).toEqual({ warnings: [] });
        expect(result.emptyHas).toBe(true);
        expect(result.none).toEqual({ confidence: 0.1 });
        expect(result.largeCount).toBe(150);
        expect(result.copied).toEqual({ warnings: [{ code: "S", message: "m" }] });
    });

    test("sanitizes malformed warnings on read without throwing", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async trustUrl => {
            const { getTrustSignals, hasTrustSignals } = await import(trustUrl);
            const read = (warnings: unknown) =>
                getTrustSignals(
                    new CustomEvent("x", { detail: { __trust: { warnings } } }),
                );

            return {
                nullWarnings: read(null),
                undefinedWarnings: read(undefined),
                notArray: read("nope"),
                badSeverity: read([{ code: "A", message: "m", severity: "fatal" }]),
                mixed: read([
                    null,
                    "str",
                    { code: "A" },
                    { message: "m" },
                    { code: 1, message: "m" },
                    { code: "OK", message: "kept", details: [1], severity: "info" },
                    { code: "OK2", message: "kept2", details: { a: 1 }, extra: true },
                ]),
                hasOnlyBad: hasTrustSignals(
                    new CustomEvent("x", { detail: { __trust: { warnings: null } } }),
                ),
            };
        }, trustModuleUrl);

        expect(result.nullWarnings).toEqual({});
        expect(result.undefinedWarnings).toEqual({});
        expect(result.notArray).toEqual({});
        expect(result.badSeverity).toEqual({
            warnings: [{ code: "A", message: "m" }],
        });
        expect(result.mixed).toEqual({
            warnings: [
                { code: "OK", message: "kept", severity: "info" },
                { code: "OK2", message: "kept2", details: { a: 1 } },
            ],
        });
        expect(result.hasOnlyBad).toBe(false);
    });
});
