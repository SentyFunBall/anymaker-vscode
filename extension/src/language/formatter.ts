import { parseProgram } from "./parser";
import { lex } from "./lexer";
import type { GSParseResult, GSLexResult } from "./tokens";
import { GSBlockStatement, GSIfStatement, GSStatement, GSDeclarationStatement, GSAssignmentStatement, GSCallStatement, GSForeachStatement, GSWhileStatement, GSEventStatement, GSListOperationStatement, GSExpressionStatement, GSExpression, GSVariableExpression, GSProgram } from './syntax';


export namespace GSFormatter {

    class Writer {
        private output = "";
        private indentLevel = 0;
        private atLineStart = true;

        indent(): void {
            this.indentLevel++;
        }

        dedent(): void {
            if (this.indentLevel > 0) {
                this.indentLevel--;
            }
        }

        getIndent(): string {
            return '\t'.repeat(this.indentLevel);
        }

        write(text: string): void {
            if (this.atLineStart && text.length > 0) {
                this.output += this.getIndent();
                this.atLineStart = false;
            }
            this.output += text; 
        }

        space(): void {
            if (!this.atLineStart && !this.output.endsWith(' ')) {
                this.output += ' ';
            }
        }

        newline(): void {
            this.output += '\n';
            this.atLineStart = true;
        }

        toString(): string {
            return this.output.trimEnd() + '\n';
        }
    }

    export class Formatter {
        private formatBlock(node: GSBlockStatement, writer: Writer): void {
            writer.write("{");
            writer.newline();
            writer.indent();
            for (const stmt of node.statements) {
                this.formatStatement(stmt, writer);
            }
            writer.dedent();
            writer.write("}");
            writer.newline();
        }

        private formatIfStatement(node: GSIfStatement, writer: Writer): void {
            // Implement formatting for IfStatement here
            writer.write("if (");
            this.formatExpression(node.condition, writer);
            writer.write(")");
            writer.newline();
            this.formatBlock(node.body, writer);
            for (const elseIfBranch of node.elseIfBranches) {
                writer.write("elseif (");
                this.formatExpression(elseIfBranch.condition, writer);
                writer.write(")");
                writer.newline();
                this.formatBlock(elseIfBranch.body, writer);
            }
            if (node.elseBody) {
                writer.write("else");
                writer.newline();
                this.formatBlock(node.elseBody, writer);
            }
        }

        private formatDeclaration(node: GSDeclarationStatement, writer: Writer): void {
            // Implement formatting for DeclarationStatement here
            writer.write("define ");
            writer.write(node.declarationType + " ");
            if (node.declarationType == "function") {
                writer.write(node.name);
                writer.write(" (");
                if (node.parameters && node.parameters.length > 0) {
                    for (let i = 0; i < node.parameters.length; i++) {
                        const param = node.parameters[i];
                        writer.write(param.dataType + " " + param.name);
                        if (i < node.parameters.length - 1) {
                            writer.write(", ");
                        }
                    }
                }
                writer.write(") ");
                writer.newline();
                if (node.body) {
                    this.formatBlock(node.body, writer);
                }
            } else {
                writer.write(node.dataType + " ");
                writer.write(node.name);
                if (node.initializer) {
                    writer.write(" = ");
                    this.formatExpression(node.initializer, writer);
                }
            }
            writer.newline();
        }

        private formatAssignment(node: GSAssignmentStatement, writer: Writer): void {
            // Implement formatting for AssignmentStatement here
            this.formatExpression(node.target, writer);
            writer.write(" = ");
            this.formatExpression(node.value, writer);
            writer.newline();
        }

        private formatCall(node: GSCallStatement, writer: Writer): void {
            // Implement formatting for CallStatement here
            writer.write("call ");
            writer.write(node.name);
            writer.write(" (");
            for (let i = 0; i < node.arguments.length; i++) {
                this.formatExpression(node.arguments[i], writer);
                if (i < node.arguments.length - 1) {
                    writer.write(", ");
                }
            }
            writer.write(")");
            writer.newline();
        }

        private formatForeach(node: GSForeachStatement, writer: Writer): void {
            // Implement formatting for ForeachStatement here
            writer.write("foreach (");
            this.formatExpression(node.iterable, writer);
            writer.write(") ");
            this.formatBlock(node.body, writer);
        }

        private formatWhile(node: GSWhileStatement, writer: Writer): void {
            // Implement formatting for WhileStatement here
            writer.write("while (");
            this.formatExpression(node.condition, writer);
            writer.write(") ");
            this.formatBlock(node.body, writer);
        }

        private formatEvent(node: GSEventStatement, writer: Writer): void {
            // Implement formatting for EventStatement here
            writer.write(node.name);
            writer.newline();
            this.formatBlock(node.body, writer);
        }

        private formatListOperation(node: GSListOperationStatement, writer: Writer): void {
            // Implement formatting for ListOperationStatement here
            this.formatExpression(node.target, writer);
            writer.write(" ");
            writer.write(node.operation + " (");
            for (let i = 0; i < node.arguments.length; i++) {
                this.formatExpression(node.arguments[i], writer);
                if (i < node.arguments.length - 1) {
                    writer.write(", ");
                }
            }
            writer.write(")");
            writer.newline();
        }

        private formatExpression(node: GSExpression, writer: Writer): void {
            // Implement formatting for ExpressionStatement here
            switch (node.kind) {
                case "IdentifierExpression":
                    writer.write(node.name);
                    break;
                case "VariableExpression":
                    writer.write(node.prefix + " " + node.name);
                    break;
                case "PathExpression":
                    writer.write(node.direction + " " + node.target + "." + node.pin);
                    break;
                case "LiteralExpression":
                    writer.write(String(node.raw ? node.raw : node.value));
                    break;
                case "UnaryExpression":
                    writer.write(node.operator + "");
                    if (node.operator != "-") {
                        writer.write(" ");
                    }
                    this.formatExpression(node.operand, writer);
                    break;
                case "BinaryExpression":
                    this.formatExpression(node.left, writer);
                    writer.write(" " + node.operator + " ");
                    this.formatExpression(node.right, writer);
                    break;
                case "CallExpression":
                    writer.write(node.name + " (");
                    for (let i = 0; i < node.arguments.length; i++) {
                        this.formatExpression(node.arguments[i], writer);
                        if (i < node.arguments.length - 1) {
                            writer.write(", ");
                        }
                    }
                    writer.write(")");
                    break;
                case "IndexExpression":
                    this.formatExpression(node.target, writer);
                    writer.write("[");
                    this.formatExpression(node.index, writer);
                    writer.write("]");
                    break;
                case "GroupExpression":
                    writer.write("(");
                    this.formatExpression(node.expression, writer);
                    writer.write(")");
                    break;
                default:
                    writer.write("#Unknown expression");
                    break;
            }
        }

        private formatUnknownStatement(node: GSStatement, writer: Writer): void {
            // Implement formatting for unknown statements here
            writer.write("#Unknown statement");
            writer.newline();
        }

        private formatStatement(node: GSStatement, writer: Writer): void {
            switch (node.kind) {
                case "BlockStatement":
                    this.formatBlock(node, writer);
                    break;

                case "IfStatement":
                    this.formatIfStatement(node, writer);
                    break;

                case "DeclarationStatement":
                    this.formatDeclaration(node, writer);
                    break;

                case "AssignmentStatement":
                    this.formatAssignment(node, writer);
                    break;

                case "CallStatement":
                    this.formatCall(node, writer);
                    break;
                
                case "ForeachStatement":
                    this.formatForeach(node, writer);
                    break;
                
                case "WhileStatement":
                    this.formatWhile(node, writer);
                    break;
                
                case "EventStatement":
                    this.formatEvent(node, writer);
                    break;
                
                case "ListOperationStatement":
                    this.formatListOperation(node, writer);
                    break;
                
                case "CommentStatement":
                    writer.write(node.text);
                    writer.newline();
                    break;

                case "ExpressionStatement":
                    this.formatExpression(node.expression, writer);
                    break;

                default:
                    this.formatUnknownStatement(node, writer);
                    break;
            }
        }

        public formatProgram(node: GSProgram, writer: Writer): void {
            for (const statement of node.statements) {
                this.formatStatement(statement, writer);
            }
        }
    }

    export function formatGeoScript(original: string): string {
        // Implement your formatting logic here
        const tokens: GSLexResult = lex(original);
        const parsed: GSParseResult = parseProgram(tokens.tokens);

        if (parsed.errors.length > 0) {
            return original;
        }

        const writer = new Writer();
        const formatter = new Formatter();
        formatter.formatProgram(parsed.program, writer);
        return writer.toString();
    }
}