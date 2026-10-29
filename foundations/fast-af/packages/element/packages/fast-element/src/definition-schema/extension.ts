import {
    registerFASTElementExtension,
    type FASTElementDefinition,
    type FASTElementExtension,
} from "../components/fast-definitions.js";
import type { Subscriber } from "../observation/notifier.js";
import { Observable } from "../observation/observable.js";
import { buildSchema } from "./extract.js";
import { registerTag, storeSchema } from "./storage.js";

const templateSubscribers = new WeakMap<FASTElementDefinition, Subscriber>();

function storeDefinitionSchema(
    definition: FASTElementDefinition,
    registry: CustomElementRegistry,
): void {
    storeSchema(definition.type, buildSchema(definition, definition.type));
    registerTag(definition.name, definition.type, registry);
}

/**
 * Extracts and stores the Agent Definition Schema for a FAST element.
 * @internal
 */
export const definitionSchemaExtension: FASTElementExtension = (definition, registry) => {
    storeDefinitionSchema(definition, registry);

    if (definition.template !== void 0 || templateSubscribers.has(definition)) {
        return;
    }

    const notifier = Observable.getNotifier(definition);
    const subscriber: Subscriber = {
        handleChange() {
            if (definition.template === void 0) {
                return;
            }

            storeDefinitionSchema(definition, registry);
            notifier.unsubscribe(subscriber, "template");
            templateSubscribers.delete(definition);
        },
    };

    templateSubscribers.set(definition, subscriber);
    notifier.subscribe(subscriber, "template");
};

let disableRegisteredExtension: (() => void) | undefined;

/**
 * Enables automatic Definition Schema extraction for subsequently defined FAST elements.
 * Call this before element definitions are registered.
 * @returns A callback that disables automatic extraction.
 * @public
 */
export function enableDefinitionSchema(): () => void {
    if (disableRegisteredExtension === void 0) {
        disableRegisteredExtension = registerFASTElementExtension(
            definitionSchemaExtension,
        );
    }

    return disableDefinitionSchema;
}

/**
 * Disables automatic Definition Schema extraction.
 * @public
 */
export function disableDefinitionSchema(): void {
    disableRegisteredExtension?.();
    disableRegisteredExtension = void 0;
}
