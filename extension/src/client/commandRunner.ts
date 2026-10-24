import * as vscode from 'vscode';
import { AMComponentRegistry } from './componentRegistry';
import { getCurrentContext, hasWorkspace, loadedMicrocontrollers } from './mcContext';

export const contextChanged = new vscode.EventEmitter<void>();

export function registerAddComponentCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'anymaker.addComponent',
        async () => {
            const mc = getCurrentContext();
            if (!hasWorkspace()) {
                vscode.window.showWarningMessage('Open a folder or workspace to add components.');
                return;
            }
            if (!mc) {
                vscode.window.showWarningMessage('Open a microcontroller file first.');
                return;
            }

            const items = AMComponentRegistry.getAllComponents().map(c => ({
                label: c.displayName || c.name,
                description: c.name,
                component: c
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Search for a component to add',
                matchOnDescription: true
            });
            if (!picked) {
                return;
            }

            mc.addComponent(picked.component);
            loadedMicrocontrollers.save();
            contextChanged.fire();
        }
    );

    context.subscriptions.push(disposable, contextChanged);
}