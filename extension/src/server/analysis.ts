import { GSBlockStatement, GSExpression, GSProgram, GSStatement } from "../language/syntax";
import { GSLexResult, GSParseResult } from "../language/tokens";
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

type GSSymbolCore =
    | "var"
    | "function"
    | "list"
    | "param";

type GSSymbolType = 
    | "integer"
    | "fractional"
    | "string"
    | "bool"
    | "analogue";

const CALL_RETURN_TYPES: Record<string, GSSymbolType | undefined> = {
    to_fractional: "fractional",
    to_integer: "integer",
};

function isNumeric(type: GSSymbolType): boolean {
    return type === "integer" || type === "fractional";
}

interface GSSymbol {
    name: string;
    core: GSSymbolCore;
    type: GSSymbolType;
    start: number;
    scopeID: number;
}

interface GSScope {
    id: number;
    parent: GSScope | undefined;
    symbols: GSSymbol[];
}

const ILLEGAL_NAMES = /^(?:if|else|for|foreach|while|function|var|define|out|in)$/;

/**
 * Walks the program once, maintaining a chain of scopes. Each block gets a unique
 * scopeID and a parent link; a name is visible only if it was declared earlier in
 * the same scope or in an enclosing one.
 */
class ScopeAnalyzer {
    readonly diagnostics: Diagnostic[] = [];
    readonly symbols: GSSymbol[] = [];
    private nextScopeID = 0;
    private unresolved: { name: string; isParam: boolean; scope: GSScope; node: { start: number; end: number } }[] = [];

    constructor(private document: TextDocument) {}

    run(program: GSProgram) {
        const global = this.createScope(undefined);
        this.visitStatements(program.statements, global);
        this.reportUnresolved();
    }

    // Runs after the walk so declarations that appear later in the file are known.
    private reportUnresolved() {
        for (const { name, isParam, scope, node } of this.unresolved) {
            const kind = isParam ? "Parameter" : "Variable";
            const matches = (sym: GSSymbol) => sym.name === name && (sym.core === "param") === isParam;

            let declaredLater: GSSymbol | undefined;
            for (let s: GSScope | undefined = scope; s && !declaredLater; s = s.parent) {
                declaredLater = s.symbols.find(matches);
            }

            if (declaredLater) {
                const pos = this.document.positionAt(declaredLater.start);
                this.report(`${kind} "${name}" is used before its declaration (declared on line ${pos.line + 1})`, node);
                continue;
            }

            const elsewhere = this.symbols.find(matches);
            if (elsewhere) {
                const pos = this.document.positionAt(elsewhere.start);
                this.report(`${kind} "${name}" was declared in a different scope (line ${pos.line + 1}) and is not accessible here`, node);
            } else {
                this.report(`Undeclared ${kind} "${name}"`, node);
            }
        }
    }

    private createScope(parent: GSScope | undefined): GSScope {
        return { id: this.nextScopeID++, parent, symbols: [] };
    }

    private declare(scope: GSScope, name: string, core: GSSymbolCore, type: string | undefined, start: number) {
        const symbol: GSSymbol = { name, core, type: type as GSSymbolType, start, scopeID: scope.id };
        scope.symbols.push(symbol);
        this.symbols.push(symbol);
    }

    // Innermost scope wins; within a scope the first definition fixes the type.
    private lookup(scope: GSScope | undefined, name: string, wantParam: boolean): GSSymbol | undefined {
        for (let s = scope; s; s = s.parent) {
            const found = s.symbols.find(sym => sym.name === name && (sym.core === "param") === wantParam);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    private report(message: string, node: { start: number; end: number }) {
        this.diagnostics.push({
            severity: DiagnosticSeverity.Error,
            message,
            range: {
                start: this.document.positionAt(node.start),
                end: this.document.positionAt(node.end)
            }
        });
    }

    private checkName(name: string, node: { start: number; end: number }) {
        if (ILLEGAL_NAMES.test(name)) {
            this.report(`Illegal variable name "${name}"`, node);
        }
    }

    private visitBlock(block: GSBlockStatement | undefined, parent: GSScope, preload?: (scope: GSScope) => void) {
        if (!block) {
            return;
        }
        const scope = this.createScope(parent);
        preload?.(scope);
        this.visitStatements(block.statements, scope);
    }

    private visitStatements(statements: GSStatement[], scope: GSScope) {
        for (const statement of statements) {
            this.visitStatement(statement, scope);
        }
    }

    private visitStatement(statement: GSStatement, scope: GSScope) {
        switch (statement.kind) {
            case "DeclarationStatement": {
                // initializer is evaluated before the name becomes visible
                if (statement.initializer) {
                    const initType = this.visitExpression(statement.initializer, scope);
                    this.checkAssignable(statement.dataType as GSSymbolType | undefined, initType, `${statement.declarationType} "${statement.name}"`, statement.initializer);
                }
                this.checkName(statement.name, statement);
                this.declare(scope, statement.name, statement.declarationType as GSSymbolCore, statement.dataType, statement.start);
                for (const param of statement.parameters ?? []) {
                    this.checkName(param.name, param);
                }
                if (statement.body) {
                    this.visitBlock(statement.body, scope, inner => {
                        for (const param of statement.parameters ?? []) {
                            this.declare(inner, param.name, "param", param.dataType, param.start);
                        }
                    });
                }
                break;
            }
            case "AssignmentStatement": {
                const targetType = this.visitExpression(statement.target, scope);
                const valueType = this.visitExpression(statement.value, scope);
                const name = statement.target.kind === "VariableExpression" ? `${statement.target.prefix} "${statement.target.name}"` : "target";
                this.checkAssignable(targetType, valueType, name, statement.value);
                break;
            }
            case "BlockStatement":
                this.visitBlock(statement, scope);
                break;
            case "IfStatement":
                this.checkCondition(statement.condition, scope);
                this.visitBlock(statement.body, scope);
                for (const branch of statement.elseIfBranches ?? []) {
                    this.checkCondition(branch.condition, scope);
                    this.visitBlock(branch.body, scope);
                }
                this.visitBlock(statement.elseBody, scope);
                break;
            case "WhileStatement":
                this.checkCondition(statement.condition, scope);
                this.visitBlock(statement.body, scope);
                break;
            case "ForeachStatement":
                this.visitExpression(statement.iterable, scope);
                this.visitBlock(statement.body, scope);
                break;
            case "EventStatement":
                this.visitBlock(statement.body, scope);
                break;
            case "CallStatement":
                statement.arguments.forEach(arg => this.visitExpression(arg, scope));
                break;
            case "ListOperationStatement":
                this.visitExpression(statement.target, scope);
                statement.arguments.forEach(arg => this.visitExpression(arg, scope));
                break;
            case "ExpressionStatement":
                this.visitExpression(statement.expression, scope);
                break;
            default:
                break;
        }
    }

    private checkCondition(condition: GSExpression, scope: GSScope) {
        const type = this.visitExpression(condition, scope);
        if (type && type !== "bool") {
            this.report(`Condition must be of type bool, but got ${type}`, condition);
        }
    }

    private checkAssignable(expected: GSSymbolType | undefined, actual: GSSymbolType | undefined, what: string, node: { start: number; end: number }) {
        if (expected && actual && expected !== actual) {
            this.report(`Type mismatch: cannot assign ${actual} to ${what} of type ${expected}`, node);
        }
    }

    /** Visits an expression and returns its inferred type, or undefined when unknown. */
    private visitExpression(expression: GSExpression | undefined, scope: GSScope): GSSymbolType | undefined {
        if (!expression) {
            return undefined;
        }
        switch (expression.kind) {
            case "VariableExpression": {
                const isParam = expression.prefix === "param";
                const symbol = this.lookup(scope, expression.name, isParam);
                if (!symbol) {
                    this.unresolved.push({ name: expression.name, isParam, scope, node: expression });
                }
                return symbol?.type;
            }
            case "LiteralExpression":
                if (typeof expression.value === "boolean") {
                    return "bool";
                }
                if (typeof expression.value === "string") {
                    return "string";
                }
                if (typeof expression.value === "number") {
                    return expression.raw?.includes(".") ? "fractional" : "integer";
                }
                return undefined;
            case "CallExpression":
                expression.arguments.forEach(arg => this.visitExpression(arg, scope));
                return CALL_RETURN_TYPES[expression.name];
            case "BinaryExpression": {
                const left = this.visitExpression(expression.left, scope);
                const right = this.visitExpression(expression.right, scope);
                return this.checkBinary(expression.operator, left, right, expression);
            }
            case "UnaryExpression": {
                const operand = this.visitExpression(expression.operand, scope);
                if (expression.operator === "!") {
                    if (operand && operand !== "bool") {
                        this.report(`Operator "!" cannot be applied to ${operand}`, expression);
                    }
                    return "bool";
                }
                if (expression.operator === "-" || expression.operator === "+") {
                    if (operand && !isNumeric(operand)) {
                        this.report(`Operator "${expression.operator}" cannot be applied to ${operand}`, expression);
                        return undefined;
                    }
                    return operand;
                }
                return undefined;
            }
            case "IndexExpression": {
                const target = this.visitExpression(expression.target, scope);
                const index = this.visitExpression(expression.index, scope);
                if (index && index !== "integer") {
                    this.report(`List index must be an integer, but got ${index}`, expression.index);
                }
                // a list is typed by its element type
                return expression.target.kind === "VariableExpression" ? target : undefined;
            }
            case "GroupExpression":
                return this.visitExpression(expression.expression, scope);
            default:
                return undefined;
        }
    }

    private checkBinary(operator: string, left: GSSymbolType | undefined, right: GSSymbolType | undefined, node: { start: number; end: number }): GSSymbolType | undefined {
        const fail = () => {
            this.report(`Operator "${operator}" cannot be applied to ${left} and ${right}`, node);
        };
        switch (operator) {
            case "&&":
            case "||":
                if ((left && left !== "bool") || (right && right !== "bool")) {
                    fail();
                }
                return "bool";
            case "==":
            case "!=":
            case "<":
            case ">":
            case "<=":
            case ">=": {
                if (left && right) {
                    const compatible = left === right || (isNumeric(left) && isNumeric(right));
                    if (!compatible) {
                        fail();
                    }
                }
                return "bool";
            }
            case "+":
            case "-":
            case "*":
            case "/":
            case "%": {
                if (!left || !right) {
                    return undefined;
                }
                if (isNumeric(left) && isNumeric(right)) {
                    return left === "fractional" || right === "fractional" ? "fractional" : "integer";
                }
                if (operator === "+" && left === "string" && right === "string") {
                    return "string";
                }
                fail();
                return undefined;
            }
            default:
                return undefined;
        }
    }
}

export function semanticAnalysis(lexResult: GSLexResult, parseResult: GSParseResult, document: TextDocument): Diagnostic[] {
    console.log("Running semantic analysis for document:", document.uri);
    const analyzer = new ScopeAnalyzer(document);
    analyzer.run(parseResult.program);
    return analyzer.diagnostics;
}
