import {
    CodeAction,
    CodeActionKind,
    createConnection,
    ProposedFeatures,
    TextDocuments,
} from 'vscode-languageserver/node';
import { validateDocument } from './diagnostics';
import { ComponentState, ContextsMessage, NOT_IN_CONTEXT_CODE } from './componentChecks';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const componentState = new ComponentState();

console.log("Language server loaded from:", __filename);

connection.onInitialize(() => {
    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: 1,
            },
            codeActionProvider: {
                codeActionKinds: [CodeActionKind.QuickFix]
            }
        }
    };
});

const revalidateAll = () => {
    for (const document of documents.all()) {
        validateDocument(document, connection, componentState);
    }
};

connection.onNotification('anymaker/registry', (registry) => {
    componentState.setRegistry(registry);
    revalidateAll();
});

connection.onNotification('anymaker/contexts', (message: ContextsMessage) => {
    componentState.setContexts(message);
    revalidateAll();
});

connection.onCodeAction(params => {
    const actions: CodeAction[] = [];
    for (const diagnostic of params.context.diagnostics) {
        const data = diagnostic.data as { componentId?: string; uri?: string } | undefined;
        if (diagnostic.code !== NOT_IN_CONTEXT_CODE || !data?.componentId || !data.uri) {
            continue;
        }
        const def = componentState.findInRegistry(data.componentId);
        actions.push({
            title: `Add "${def?.displayName ?? data.componentId}" to microcontroller context`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
                title: 'Add component to context',
                command: 'anymaker.addComponentToContext',
                arguments: [data.uri, data.componentId]
            }
        });
    }
    return actions;
});

documents.onDidOpen(({ document }) => {
    validateDocument(document, connection, componentState);
});

documents.onDidChangeContent(({ document }) => {
    validateDocument(document, connection, componentState);
});

documents.listen(connection);
connection.listen();