import { attr } from "@lushly-dev/fast-element/attr.js";
import { declarativeTemplate } from "@lushly-dev/fast-element/declarative.js";
import { FASTElement } from "@lushly-dev/fast-element/fast-element.js";
import { observable } from "@lushly-dev/fast-element/observable.js";

class BasicElement extends FASTElement {
    @attr
    greeting: string = "Hello";
}

const basicDefinition = BasicElement.define({
    name: "basic-element",
    template: declarativeTemplate(),
});

class CounterElement extends FASTElement {
    @observable
    count: number = 0;

    increment() {
        this.count++;
    }
}

const counterDefinition = CounterElement.define({
    name: "counter-element",
    template: declarativeTemplate(),
});

void Promise.all([basicDefinition, counterDefinition]).then(() => {
    (window as any).allDefined = true;
});
