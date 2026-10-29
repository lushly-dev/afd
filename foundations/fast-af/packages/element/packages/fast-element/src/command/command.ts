/**
 * The `command` decorator for FASTElement methods.
 * Binds methods to the Command Registry for AI agent interaction.
 *
 * @remarks
 * Uses FAST's createMetadataLocator with push() pattern for metadata storage.
 * Metadata is discovered at connect-time by CommandBehavior.
 *
 * @example
 * ```typescript
 * import { FASTElement } from '@lushly-dev/fast-element';
 * import { command, success } from '@lushly-dev/fast-element/command.js';
 *
 * class MyEditor extends FASTElement {
 *   @command('editor.save', { label: 'Save', keybinding: 'Ctrl+S' })
 *   save(): CommandResult {
 *     // Save logic here
 *     return success({ saved: true });
 *   }
 * }
 * ```
 */

import { registerElementControllerBehaviorFactory } from "../components/element-controller.js";
import { createMetadataLocator } from "../platform.js";
import { CommandBehavior } from "./behavior.js";
import type { CommandId, CommandMetadata, CommandOptions } from "./types.js";

/**
 * Locates command metadata associated with a class.
 * @remarks
 * Uses FAST's createMetadataLocator pattern with WeakMap storage.
 * Traverses prototype chain for inherited commands.
 * @internal
 */
const commandMetadata = createMetadataLocator<CommandMetadata>();

registerElementControllerBehaviorFactory(element =>
    getCommandMetadata(element.constructor).length > 0 ? new CommandBehavior() : void 0,
);

/**
 * Retrieves all command metadata for a given class.
 *
 * @param target - The class constructor to retrieve metadata for
 * @returns Array of CommandMetadata for all `command` decorators on the class
 *
 * @example
 * ```typescript
 * const metadata = getCommandMetadata(MyEditor);
 * console.log(metadata); // [{ id: 'editor.save', methodName: 'save', ... }]
 * ```
 *
 * @public
 */
export function getCommandMetadata(target: Function): readonly CommandMetadata[] {
    return commandMetadata(target);
}

/**
 * Decorator that registers a method as a command.
 * Commands are discoverable by AI agents and command palettes.
 *
 * @param id - Namespace-prefixed command identifier (e.g., "editor.save")
 * @param options - Optional command configuration
 * @returns A method decorator
 *
 * @remarks
 * - Command IDs must include a namespace prefix (e.g., "app.action")
 * - Runtime warning is emitted if namespace is missing
 * - Metadata is stored using FAST's push() pattern
 * - Commands are registered with CommandRegistry when element connects
 *
 * @example
 * ```typescript
 * class TextEditor extends FASTElement {
 *   // Basic command
 *   @command('editor.selectAll')
 *   selectAll(): CommandResult {
 *     return success({ selected: true });
 *   }
 *
 *   // Command with full options
 *   @command('editor.save', {
 *     label: 'Save Document',
 *     icon: 'save',
 *     description: 'Save the current document',
 *     category: 'File',
 *     keybinding: 'Ctrl+S',
 *     when: 'editorFocus'
 *   })
 *   save(): CommandResult {
 *     return success({ saved: true });
 *   }
 * }
 * ```
 *
 * @public
 */
export function command(
    id: CommandId,
    options?: CommandOptions,
): (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
) => PropertyDescriptor {
    return function (
        target: object,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        // Runtime validation for namespace prefix
        if (!id.includes(".")) {
            console.warn(
                `[fast-af] Command "${id}" missing namespace prefix. ` +
                    `Use format: "namespace.action" (e.g., "editor.save")`,
            );
        }

        // Store metadata using FAST's push() pattern
        // target is the prototype, target.constructor is the class
        commandMetadata((target as { constructor: Function }).constructor).push({
            id,
            methodName: propertyKey,
            ...options,
        });

        return descriptor;
    };
}
