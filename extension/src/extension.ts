import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

import { GSFormatter } from './language/formatter';
import { AMComponentRegistry } from './client/componentRegistry';
import { registerComponentsView } from './client/mcConfigView';
import { loadedMicrocontrollers } from './client/mcContext';
import { registerAddComponentCommand } from './client/commandRunner';
import { registerAddToContextCommand, startContextSync } from './client/contextSync';

let client: LanguageClient | undefined;

const config = vscode.workspace.getConfiguration('geoscript');

export async function activate(context: vscode.ExtensionContext) {
    console.log('Starting GeoScript language support');

    // Restore saved components for this workspace
    // register component registry (must precede loading saved contexts)
    const componentRegistry = new AMComponentRegistry();
    const registeredComponents = componentRegistry.registerComponents(config.get<string>('core.anymakerinstallationpath'));
    if (registeredComponents === 0) {
        vscode.window.showWarningMessage('No Anymaker components registered! Is your Anymaker installation path correct? (Check your settings)');
    }

    loadedMicrocontrollers.load();
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => loadedMicrocontrollers.load())
    );

    // Tree view for the sidebar
    registerComponentsView(context);

    // commands
    registerAddComponentCommand(context);
    registerAddToContextCommand(context);

    // register formatter
    const formatter = vscode.languages.registerDocumentFormattingEditProvider('geoscript', {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
            const original = document.getText();
            const formatted = GSFormatter.formatGeoScript(original);

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(original.length)
            );

            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    });
    context.subscriptions.push(formatter);

    // start language client for GeoScript
    const serverModule = context.asAbsolutePath(path.join('out', 'extension', 'src', 'server', 'server.js'));
    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: {
                execArgv: ['--nolazy', '--inspect=6009']
            }
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'geoscript' }]
    };

    client = new LanguageClient(
        'anymakergeoscript',
        'Anymaker GeoScript',
        serverOptions,
        clientOptions
    );

    console.log("Language server debug port 6009");
    context.subscriptions.push(client);
    await client.start();
    startContextSync(client, context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}