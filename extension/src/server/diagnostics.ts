import { preprocessScript } from '../language/preprocess';
import { lex } from '../language/lexer';
import { parseProgram } from '../language/parser';
import { semanticAnalysis } from './analysis';
import { checkComponents, ComponentState } from './componentChecks';

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function validateDocument(document: TextDocument, connection: any, state: ComponentState) {
    console.log("Validating document:", document.uri);
    const source = document.getText();
    const lexResult = lex(preprocessScript(source));
    const parseResult = parseProgram(lexResult.tokens);

    const diagnostics: Diagnostic[] = [];
    for (const error of lexResult.errors) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: document.positionAt(error.start),
                end: document.positionAt(error.end),
            },
            message: error.message,
            source: "GeoScript Lexer"
        });
    }

    for (const error of parseResult.errors) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: document.positionAt(error.start),
                end: document.positionAt(error.end),
            },
            message: error.message,
            source: "GeoScript Parser"
        });
    }

    const semanticDiagnostics = semanticAnalysis(lexResult, parseResult, document);
    diagnostics.push(...semanticDiagnostics);
    diagnostics.push(...checkComponents(parseResult.program, document, state));

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
