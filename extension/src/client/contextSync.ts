import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { AMComponentRegistry } from './componentRegistry';
import { contextChanged } from './commandRunner';
import { hasWorkspace, loadedMicrocontrollers } from './mcContext';

// Pushes the component registry and per-file contexts to the language server.
export function startContextSync(client: LanguageClient, context: vscode.ExtensionContext) {
    const sendContexts = () => {
        if (!client.isRunning()) {
            return;
        }
        const contexts: Record<string, { id: string; alias?: string }[]> = {};
        for (const mc of loadedMicrocontrollers.getMicrocontrollers()) {
            contexts[vscode.Uri.file(mc.fileName).toString()] =
                mc.components.map(c => ({ id: c.name, alias: c.alias }));
        }
        void client.sendNotification('anymaker/contexts', {
            hasWorkspace: hasWorkspace(),
            contexts
        });
    };

    void client.sendNotification('anymaker/registry', AMComponentRegistry.getAllComponents());
    sendContexts();

    context.subscriptions.push(
        loadedMicrocontrollers.onDidChange(sendContexts),
        contextChanged.event(sendContexts)
    );
}

export function registerAddToContextCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'anymaker.addComponentToContext',
            (uri: string, componentId: string) => {
                if (!hasWorkspace()) {
                    vscode.window.showWarningMessage('Open a folder or workspace to add components.');
                    return;
                }
                const def = AMComponentRegistry.getAllComponents().find(c => c.name === componentId);
                if (!def) {
                    return;
                }
                const mc = loadedMicrocontrollers.getOrCreate(vscode.Uri.parse(uri).fsPath);
                if (!mc.getComponents().some(c => c.name === componentId && !c.alias)) {
                    mc.addComponent(def);
                    loadedMicrocontrollers.save();
                    contextChanged.fire();
                }
            }
        )
    );
}
