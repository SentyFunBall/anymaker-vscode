import * as Syntax from "./syntax";
import { GSParseResult, GSToken, GSParseError, GSTokenKind, GSLexResult } from "./tokens";
import { lex } from "./lexer";

enum Precedence {
    None = 0,
    Or = 1,          // ||
    And = 2,         // &&
    Equality = 3,    // ==, !=
    Relational = 4,  // <, <=, >, >=
    Additive = 5,    // +, -
    Multiplicative = 6, // *, /, %
    Unary = 7,       // !, -, +
    Call = 8,        // name(...), [...]
    Primary = 9
}

export class GSParser {
    private tokens: GSToken[];
    private position: number;
    private errors: GSParseError[];
    private source?: string;
    private allComments: Syntax.GSCommentStatement[];

    constructor(tokens: GSToken[], source?: string) {
        this.tokens = tokens;
        this.position = 0;
        this.errors = [];
        this.source = source;
        this.allComments = [];
    }

    // ==========================================
    // 1. Token Utilities
    // ==========================================

    private isWhitespace(token: GSToken): boolean {
        return token.kind === "Whitespace" || token.kind === "Newline";
    }

    private skipWhitespace(): void {
        while (this.position < this.tokens.length && this.isWhitespace(this.tokens[this.position])) {
            this.position++;
        }
    }

    private recordComment(token: GSToken): Syntax.GSCommentStatement {
        const existing = this.allComments.find(c => c.start === token.start);
        if (existing) {
            return existing;
        }
        const comment: Syntax.GSCommentStatement = {
            kind: "CommentStatement",
            text: token.text,
            value: token.text.startsWith("#") ? token.text.slice(1).trim() : token.text,
            start: token.start,
            end: token.end
        };
        this.allComments.push(comment);
        return comment;
    }

    private skipWhitespaceAndComments(): void {
        while (this.position < this.tokens.length) {
            const tok = this.tokens[this.position];
            if (this.isWhitespace(tok)) {
                this.position++;
            } else if (tok.kind === "Comment") {
                this.recordComment(tok);
                this.position++;
            } else {
                break;
            }
        }
    }

    public current(): GSToken {
        this.skipWhitespace();
        if (this.position >= this.tokens.length) {
            const last = this.tokens[this.tokens.length - 1];
            return last ?? { kind: "EOF", text: "", start: 0, end: 0, line: 0, column: 0 };
        }
        return this.tokens[this.position];
    }

    public isAtEnd(): boolean {
        this.skipWhitespace();
        if (this.position >= this.tokens.length) {
            return true;
        }
        return this.tokens[this.position].kind === "EOF";
    }

    public advance(): GSToken {
        const tok = this.current();
        if (!this.isAtEnd()) {
            this.position++;
            this.skipWhitespace();
        }
        return tok;
    }

    public peek(offset = 1): GSToken {
        let count = 0;
        let idx = this.position;
        // Skip whitespace to reach current token
        while (idx < this.tokens.length && this.isWhitespace(this.tokens[idx])) {
            idx++;
        }
        // Advance past current token
        if (idx < this.tokens.length) {
            idx++;
        }
        // Look for the offset-th non-trivia token (skipping whitespace AND comments for syntax decisions)
        while (idx < this.tokens.length) {
            const tok = this.tokens[idx];
            if (!this.isWhitespace(tok) && tok.kind !== "Comment") {
                count++;
                if (count === offset) {
                    return tok;
                }
            }
            idx++;
        }
        const last = this.tokens[this.tokens.length - 1];
        return last ?? { kind: "EOF", text: "", start: 0, end: 0, line: 0, column: 0 };
    }

    private isNextSyntaxIdentifier(ident: string): boolean {
        let idx = this.position;
        while (idx < this.tokens.length) {
            const tok = this.tokens[idx];
            if (!this.isWhitespace(tok) && tok.kind !== "Comment") {
                return tok.kind === "Identifier" && tok.text === ident;
            }
            idx++;
        }
        return false;
    }

    public addError(message: string, start: number, end: number): void {
        this.errors.push({ message, start, end });
    }

    // ==========================================
    // 2. Program and Statement Parsing
    // ==========================================

    public parseGSProgram(): GSParseResult {
        this.allComments = [];
        const statements: Syntax.GSStatement[] = [];
        const programStart = this.tokens.length > 0 ? this.tokens[0].start : 0;

        this.skipWhitespace();

        while (!this.isAtEnd()) {
            const beforePos = this.position;
            const stmt = this.parseStatement();
            if (stmt) {
                statements.push(stmt);
            }

            // Guarantee forward progress on malformed input
            if (this.position <= beforePos && !this.isAtEnd()) {
                const tok = this.current();
                this.addError(`Unexpected token: '${tok.text}'`, tok.start, tok.end);
                statements.push({
                    kind: "UnknownStatement",
                    start: tok.start,
                    end: tok.end
                });
                this.advance();
            }
        }

        const lastToken = this.tokens[this.tokens.length - 1];
        const programEnd = lastToken ? lastToken.end : 0;

        return {
            program: {
                kind: "Program",
                start: programStart,
                end: programEnd,
                statements,
                comments: this.allComments
            },
            errors: this.errors
        };
    }

    private static readonly DATA_TYPES = new Set(["integer", "fractional", "bool", "string", "analogue"]);
    private static readonly LIST_OPERATIONS = new Set(["append", "erase", "insert", "remove", "clear"]);

    private skipRestOfLine(line: number): void {
        while (!this.isAtEnd() && this.current().line === line && !(this.current().kind === "Punctuation" && this.current().text === "{")) {
            this.advance();
        }
    }

    private reportBadStatementStart(tok: GSToken): Syntax.GSStatement {
        let message: string;
        if (tok.text === "function") {
            message = "Unexpected keyword 'function'; function declarations must start with 'define' (e.g. 'define function name (integer i)')";
        } else if (tok.text === "let") {
            message = "Unexpected statement 'let'; declare variables with 'define var <type> <name>'";
        } else if (GSParser.DATA_TYPES.has(tok.text)) {
            message = `Unexpected type '${tok.text}'; declarations must be 'define var ${tok.text} <name>'`;
        } else {
            message = `Unexpected token: '${tok.text}'`;
        }
        this.addError(message, tok.start, tok.end);
        this.advance();
        this.skipRestOfLine(tok.line);
        return { kind: "UnknownStatement", start: tok.start, end: tok.end };
    }

    public parseStatement(): Syntax.GSStatement | undefined {
        this.skipWhitespace();
        if (this.isAtEnd()) {
            return undefined;
        }

        const tok = this.current();

        // 0. Comment statement: # ...
        if (tok.kind === "Comment") {
            this.advance();
            return this.recordComment(tok);
        }

        // 1. Block statement: { ... }
        if (tok.kind === "Punctuation" && tok.text === "{") {
            return this.parseBlockStatement();
        }

        // 2. Control flow: if
        if (tok.kind === "Identifier" && tok.text === "if") {
            return this.parseIfStatement();
        }

        // 3. Control flow: foreach
        if (tok.kind === "Identifier" && tok.text === "foreach") {
            return this.parseForeachStatement();
        }

        // 4. Control flow: while
        if (tok.kind === "Identifier" && tok.text === "while") {
            return this.parseWhileStatement();
        }

        // 5. Declarations: define ...
        if (tok.kind === "Identifier" && tok.text === "define") {
            return this.parseDeclarationStatement();
        }

        // 6. Function call statement: call count (var i)
        if (tok.kind === "Identifier" && tok.text === "call") {
            return this.parseCallStatement();
        }

        // 7. Event handler: on_tick { ... } or any on_* followed by {
        if (tok.kind === "Identifier" && (tok.text === "on_tick" || (tok.text.startsWith("on_") && this.peek().kind === "Punctuation" && this.peek().text === "{"))) {
            return this.parseEventStatement();
        }

        // 8. Unexpected control flow: elseif or else outside if
        if (tok.kind === "Identifier" && (tok.text === "elseif" || tok.text === "else")) {
            const start = tok.start;
            const end = tok.end;
            this.addError(`Unexpected '${tok.text}' outside of if statement`, start, end);
            this.advance();
            return {
                kind: "UnknownStatement",
                start,
                end
            };
        }

        // 9. in / out paths at statement level:
        // e.g. in 7 Segment LCD Display.display_value = var rps_avg
        // e.g. in Gear_motor.input = 0.0
        if (tok.kind === "Identifier" && (tok.text === "in" || tok.text === "out")) {
            const path = this.parsePathExpression();
            if (!this.isAtEnd() && this.current().kind === "Operator" && this.current().text === "=") {
                this.advance(); // consume '='
                const value = this.parseExpression();
                return {
                    kind: "AssignmentStatement",
                    target: path,
                    value,
                    start: path.start,
                    end: value.end
                };
            }
            // Expression statement with path
            const expr = this.parseExpressionWithLeft(path);
            return {
                kind: "ExpressionStatement",
                expression: expr,
                start: expr.start,
                end: expr.end
            };
        }

        // 10. General expression, assignment, or list operation
        if (tok.kind === "Identifier" && tok.text !== "var" && tok.text !== "param" &&
            !(this.peek().kind === "Punctuation" && this.peek().text === "(")) {
            return this.reportBadStatementStart(tok);
        }

        const left = this.parsePrimary();

        // `var erase (0)`: list operation without a target
        if (left.kind === "VariableExpression" && GSParser.LIST_OPERATIONS.has(left.name) &&
            this.current().kind === "Punctuation" && this.current().text === "(") {
            this.addError(`List operation '${left.name}' requires a target (e.g. 'var my_list ${left.name} (...)')`, left.start, left.end);
            this.parseArgumentList();
            return { kind: "UnknownStatement", start: left.start, end: left.end };
        }

        // Check for list operation:
        // <target> <operation> ( <args> ) or <target>.<operation> ( <args> )
        // e.g. var rps_list append (out Engine.rps)
        if (!this.isAtEnd()) {
            let opName = "";
            let opStart = 0;
            let opEnd = 0;

            if (this.current().kind === "Identifier" && this.peek().kind === "Punctuation" && this.peek().text === "(") {
                const opTok = this.advance();
                opName = opTok.text;
                opStart = opTok.start;
                opEnd = opTok.end;
            } else if (this.current().kind === "Punctuation" && this.current().text === "." &&
                       this.peek().kind === "Identifier" && this.peek(2).kind === "Punctuation" && this.peek(2).text === "(") {
                this.advance(); // consume '.'
                const opTok = this.advance();
                opName = opTok.text;
                opStart = opTok.start;
                opEnd = opTok.end;
            }

            if (opName) {
                const args = this.parseArgumentList();
                const end = args.closeParenEnd ?? (args.expressions.length > 0 ? args.expressions[args.expressions.length - 1].end : opEnd);
                return {
                    kind: "ListOperationStatement",
                    target: left,
                    operation: opName,
                    arguments: args.expressions,
                    start: left.start,
                    end
                };
            }
        }

        // Check for assignment: target = value
        if (!this.isAtEnd() && this.current().kind === "Operator" && this.current().text === "=") {
            this.advance(); // consume '='
            const value = this.parseExpression();
            return {
                kind: "AssignmentStatement",
                target: left,
                value,
                start: left.start,
                end: value.end
            };
        }

        // Check for bare call as statement: name(args)
        if (left.kind === "CallExpression") {
            return {
                kind: "CallStatement",
                name: left.name,
                arguments: left.arguments,
                start: left.start,
                end: left.end
            };
        }

        // Expression statement
        if (left.kind === "VariableExpression" && left.prefix === "var" && left.name) {
            this.addError(`Missing declaration for 'var ${left.name}'; declare it with 'define var <type> ${left.name}'`, left.start, left.end);
        }
        const expr = this.parseExpressionWithLeft(left);
        return {
            kind: "ExpressionStatement",
            expression: expr,
            start: expr.start,
            end: expr.end
        };
    }

    // ==========================================
    // 3. Blocks and Control Flow
    // ==========================================

    public parseBlockStatement(): Syntax.GSBlockStatement {
        this.skipWhitespaceAndComments();
        const openBrace = this.current();
        if (openBrace.kind !== "Punctuation" || openBrace.text !== "{") {
            this.addError("Expected '{' to start block", openBrace.start, openBrace.end);
            return {
                kind: "BlockStatement",
                start: openBrace.start,
                end: openBrace.start,
                statements: []
            };
        }

        const start = openBrace.start;
        this.advance(); // consume '{'

        const statements: Syntax.GSStatement[] = [];

        while (!this.isAtEnd()) {
            this.skipWhitespace();
            if (this.current().kind === "Punctuation" && this.current().text === "}") {
                break;
            }

            const beforePos = this.position;
            const stmt = this.parseStatement();
            if (stmt) {
                statements.push(stmt);
            }

            // Progress check inside block
            if (this.position <= beforePos && !this.isAtEnd() && !(this.current().kind === "Punctuation" && this.current().text === "}")) {
                const tok = this.current();
                this.addError(`Unexpected token: '${tok.text}'`, tok.start, tok.end);
                statements.push({
                    kind: "UnknownStatement",
                    start: tok.start,
                    end: tok.end
                });
                this.advance();
            }
        }

        if (this.isAtEnd()) {
            const lastTok = this.tokens[this.tokens.length - 1];
            const end = lastTok ? lastTok.end : start;
            this.addError("Expected '}' to close block", start, end);
            return {
                kind: "BlockStatement",
                start,
                end,
                statements
            };
        }

        const closeBrace = this.advance(); // consume '}'

        return {
            kind: "BlockStatement",
            start,
            end: closeBrace.end,
            statements
        };
    }

    private parseCondition(): Syntax.GSExpression {
        this.skipWhitespaceAndComments();
        if (this.current().kind === "Punctuation" && this.current().text === "(") {
            this.advance(); // consume '('
            this.skipWhitespaceAndComments();
            const expr = this.parseExpression();
            this.skipWhitespaceAndComments();
            if (this.current().kind === "Punctuation" && this.current().text === ")") {
                this.advance(); // consume ')'
            } else {
                this.addError("Expected ')' after condition", expr.end, this.current().start);
            }
            return expr;
        }
        return this.parseExpression();
    }

    public parseIfStatement(): Syntax.GSIfStatement {
        const ifTok = this.advance(); // consume 'if'
        const start = ifTok.start;

        const condition = this.parseCondition();
        const body = this.parseBlockStatement();

        const elseIfBranches: { condition: Syntax.GSExpression; body: Syntax.GSBlockStatement }[] = [];

        while (!this.isAtEnd()) {
            this.skipWhitespace();
            if (this.current().kind === "Identifier" && this.current().text === "elseif") {
                this.advance(); // consume 'elseif'
                const elseIfCond = this.parseCondition();
                const elseIfBody = this.parseBlockStatement();
                elseIfBranches.push({ condition: elseIfCond, body: elseIfBody });
            } else if (this.current().kind === "Identifier" && this.current().text === "else" &&
                       this.peek().kind === "Identifier" && this.peek().text === "if") {
                this.advance(); // consume 'else'
                this.advance(); // consume 'if'
                const elseIfCond = this.parseCondition();
                const elseIfBody = this.parseBlockStatement();
                elseIfBranches.push({ condition: elseIfCond, body: elseIfBody });
            } else if (this.current().kind === "Comment" && (this.isNextSyntaxIdentifier("elseif") || (this.isNextSyntaxIdentifier("else") && this.peek().text === "if"))) {
                const commentTok = this.advance();
                this.recordComment(commentTok);
            } else {
                break;
            }
        }

        let elseBody: Syntax.GSBlockStatement | undefined;
        this.skipWhitespace();
        if (!this.isAtEnd()) {
            if (this.current().kind === "Comment" && this.isNextSyntaxIdentifier("else")) {
                const commentTok = this.advance();
                this.recordComment(commentTok);
            }
            if (this.current().kind === "Identifier" && this.current().text === "else") {
                this.advance(); // consume 'else'
                elseBody = this.parseBlockStatement();
            }
        }

        const end = elseBody ? elseBody.end : (elseIfBranches.length > 0 ? elseIfBranches[elseIfBranches.length - 1].body.end : body.end);

        return {
            kind: "IfStatement",
            condition,
            body,
            elseIfBranches,
            elseBody,
            start,
            end
        };
    }

    public parseForeachStatement(): Syntax.GSForeachStatement {
        const foreachTok = this.advance(); // consume 'foreach'
        const start = foreachTok.start;

        let iterable: Syntax.GSExpression;
        this.skipWhitespace();
        if (this.current().kind === "Punctuation" && this.current().text === "(") {
            this.advance(); // consume '('
            this.skipWhitespaceAndComments();
            iterable = this.parseExpression();
            this.skipWhitespaceAndComments();
            if (this.current().kind === "Punctuation" && this.current().text === ")") {
                this.advance(); // consume ')'
            } else {
                this.addError("Expected ')' after foreach iterable", iterable.end, this.current().start);
            }
        } else {
            iterable = this.parseExpression();
        }

        const body = this.parseBlockStatement();

        return {
            kind: "ForeachStatement",
            iterable,
            body,
            start,
            end: body.end
        };
    }

    public parseWhileStatement(): Syntax.GSWhileStatement {
        const whileTok = this.advance(); // consume 'while'
        const start = whileTok.start;

        const condition = this.parseCondition();
        const body = this.parseBlockStatement();

        return {
            kind: "WhileStatement",
            condition,
            body,
            start,
            end: body.end
        };
    }

    // ==========================================
    // 4. GeoScript-Specific Syntax
    // ==========================================

    public parseDeclarationStatement(): Syntax.GSDeclarationStatement {
        const defineTok = this.advance(); // consume 'define'
        const start = defineTok.start;

        let declarationType = "var";
        let declTypeTok: GSToken = defineTok;
        if (this.current().kind === "Identifier") {
            declTypeTok = this.advance();
            declarationType = declTypeTok.text;
        } else {
            this.addError("Expected declaration type after 'define'", defineTok.start, defineTok.end);
        }

        if (declarationType === "function") {
            let name = "";
            let end = start;
            if (this.current().kind === "Identifier") {
                const nameTok = this.advance();
                name = nameTok.text;
                end = nameTok.end;
            } else {
                this.addError("Expected function name", start, this.current().start);
            }

            const parameters: Syntax.GSParameter[] = [];
            if (this.current().kind === "Punctuation" && this.current().text === "(") {
                this.advance(); // consume '('
                while (!this.isAtEnd() && !(this.current().kind === "Punctuation" && this.current().text === ")")) {
                    this.skipWhitespaceAndComments();
                    if (this.current().kind === "Punctuation" && this.current().text === ")") {
                        break;
                    }
                    const first = this.current();
                    if (first.kind === "Identifier" && GSParser.DATA_TYPES.has(first.text)) {
                        const paramTypeTok = this.advance();
                        const pStart = paramTypeTok.start;
                        const dataType = paramTypeTok.text;

                        let paramName = "";
                        let pEnd = paramTypeTok.end;
                        if (this.current().kind === "Identifier") {
                            const paramNameTok = this.advance();
                            paramName = paramNameTok.text;
                            pEnd = paramNameTok.end;
                        } else {
                            const bad = this.current();
                            this.addError(`Expected parameter name after type '${dataType}'`, bad.start, bad.end);
                        }

                        parameters.push({
                            kind: "Parameter",
                            dataType,
                            name: paramName,
                            start: pStart,
                            end: pEnd
                        });
                    } else {
                        if (first.kind === "Identifier") {
                            this.addError(`Expected data type before parameter '${first.text}' (e.g. 'integer ${first.text}')`, first.start, first.end);
                        } else {
                            this.addError(`Expected parameter data type, found '${first.text}'`, first.start, first.end);
                        }
                        // Skip to the next separator so one bad parameter reports once
                        while (!this.isAtEnd() && !(this.current().kind === "Punctuation" && (this.current().text === "," || this.current().text === ")" || this.current().text === "{"))) {
                            this.advance();
                        }
                    }

                    this.skipWhitespaceAndComments();
                    if (this.current().kind === "Punctuation" && this.current().text === ",") {
                        this.advance();
                    } else if (this.current().kind === "Identifier") {
                        const bad = this.current();
                        this.addError(`Expected ',' or ')' but found '${bad.text}'`, bad.start, bad.end);
                        while (!this.isAtEnd() && !(this.current().kind === "Punctuation" && (this.current().text === "," || this.current().text === ")" || this.current().text === "{"))) {
                            this.advance();
                        }
                        if (this.current().kind === "Punctuation" && this.current().text === ",") {
                            this.advance();
                        }
                    } else if (this.current().kind === "Punctuation" && this.current().text === "{") {
                        break;
                    }
                }

                this.skipWhitespaceAndComments();
                if (this.current().kind === "Punctuation" && this.current().text === ")") {
                    this.advance(); // consume ')'
                } else {
                    this.addError("Expected ')' after parameter list", end, this.current().start);
                }
            }

            const body = this.parseBlockStatement();

            return {
                kind: "DeclarationStatement",
                declarationType: "function",
                name,
                parameters,
                body,
                start,
                end: body.end
            };
        }

        // Variable or list declaration:
        // define var fractional rps_totals
        // define list fractional rps_list
        // define var fractional thr = 2.0
        // define var integer i
        let dataType: string | undefined;
        let name = "";
        let end = start;

        if (declarationType !== "var" && declarationType !== "list" && this.current().kind === "Identifier") {
            // e.g. `define fractional t`: the declaration kind is missing
            if (GSParser.DATA_TYPES.has(declarationType)) {
                this.addError(`Expected 'var' or 'list' after 'define' before type '${declarationType}'`, declTypeTok.start, declTypeTok.end);
            } else {
                this.addError(`Unknown declaration type '${declarationType}'; expected 'var', 'list' or 'function'`, declTypeTok.start, declTypeTok.end);
            }
            declarationType = "var";
            const nameTok = this.advance();
            name = nameTok.text;
            end = nameTok.end;
        } else if (this.current().kind === "Identifier") {
            const firstTok = this.advance();
            end = firstTok.end;
            if (this.current().kind === "Identifier" && this.current().line === firstTok.line) {
                dataType = firstTok.text;
                if (!GSParser.DATA_TYPES.has(dataType)) {
                    this.addError(`Unknown data type '${dataType}'`, firstTok.start, firstTok.end);
                }
                const secondTok = this.advance();
                name = secondTok.text;
                end = secondTok.end;
            } else {
                name = firstTok.text;
                this.addError(`Missing data type for '${declarationType} ${name}' (e.g. 'define ${declarationType} fractional ${name}')`, firstTok.start, firstTok.end);
            }
        } else {
            this.addError("Expected variable name in declaration", start, this.current().start);
        }

        let initializer: Syntax.GSExpression | undefined;
        if (!this.isAtEnd() && this.current().kind === "Operator" && this.current().text === "=") {
            this.advance(); // consume '='
            initializer = this.parseExpression();
            end = initializer.end;
        }

        return {
            kind: "DeclarationStatement",
            declarationType,
            name,
            dataType,
            initializer,
            start,
            end
        };
    }

    public parseCallStatement(): Syntax.GSCallStatement {
        const callTok = this.advance(); // consume 'call'
        const start = callTok.start;

        let name = "";
        if (this.current().kind === "Identifier") {
            name = this.advance().text;
        } else {
            this.addError("Expected function name after 'call'", start, this.current().start);
        }

        const args = this.parseArgumentList();
        const end = args.closeParenEnd ?? (args.expressions.length > 0 ? args.expressions[args.expressions.length - 1].end : start);

        return {
            kind: "CallStatement",
            name,
            arguments: args.expressions,
            start,
            end
        };
    }

    public parseEventStatement(): Syntax.GSEventStatement {
        const eventTok = this.advance(); // consume event name e.g. on_tick
        const start = eventTok.start;
        const name = eventTok.text;

        const body = this.parseBlockStatement();

        return {
            kind: "EventStatement",
            name,
            body,
            start,
            end: body.end
        };
    }

    public parsePathExpression(): Syntax.GSPathExpression {
        const ioTok = this.advance(); // consume "in" or "out"
        const direction = ioTok.text as "in" | "out";

        const deviceTokens: GSToken[] = [];
        const targetParts: string[] = [];

        while (!this.isAtEnd()) {
            const tok = this.current();
            if (tok.kind === "Comment") {
                break;
            }
            // Don't cross multiple lines for device name
            if (tok.line > ioTok.line + 1) {
                break;
            }
            if (tok.kind === "Punctuation" && tok.text === ".") {
                break;
            }
            if (tok.kind === "Operator" || 
                (tok.kind === "Punctuation" && (tok.text === "{" || tok.text === "}" || tok.text === ";" || tok.text === ")"))) {
                break;
            }
            deviceTokens.push(tok);
            targetParts.push(tok.text);
            this.advance();
        }

        if (deviceTokens.length === 0) {
            this.addError(`Expected device name after '${direction}'`, ioTok.start, ioTok.end);
        }

        let pin = "";
        let pinStart: number | undefined;
        let pinEnd: number | undefined;
        let end = deviceTokens.length > 0 ? deviceTokens[deviceTokens.length - 1].end : ioTok.end;

        if (!this.isAtEnd() && this.current().kind === "Punctuation" && this.current().text === ".") {
            this.advance(); // consume '.'
            if (!this.isAtEnd() && this.current().kind === "Identifier") {
                const pinTok = this.advance();
                pin = pinTok.text;
                pinStart = pinTok.start;
                pinEnd = pinTok.end;
                end = pinTok.end;
            } else {
                this.addError("Expected pin identifier after '.'", end, this.isAtEnd() ? end : this.current().end);
            }
        } else {
            this.addError("Expected '.' after device name", end, this.isAtEnd() ? end : this.current().end);
        }

        let target = targetParts.join(" ");
        if (this.source && deviceTokens.length > 0) {
            target = this.source.slice(deviceTokens[0].start, deviceTokens[deviceTokens.length - 1].end);
        }

        return {
            kind: "PathExpression",
            direction,
            target,
            targetParts,
            pin,
            targetStart: deviceTokens.length > 0 ? deviceTokens[0].start : undefined,
            targetEnd: deviceTokens.length > 0 ? deviceTokens[deviceTokens.length - 1].end : undefined,
            pinStart,
            pinEnd,
            start: ioTok.start,
            end
        };
    }

    public parseArgumentList(): { expressions: Syntax.GSExpression[]; closeParenEnd?: number } {
        const expressions: Syntax.GSExpression[] = [];
        let closeParenEnd: number | undefined;

        if (this.current().kind === "Punctuation" && this.current().text === "(") {
            this.advance(); // consume '('
            while (!this.isAtEnd() && !(this.current().kind === "Punctuation" && this.current().text === ")")) {
                this.skipWhitespaceAndComments();
                if (this.current().kind === "Punctuation" && this.current().text === ")") {
                    break;
                }
                const beforePos = this.position;
                const arg = this.parseExpression();
                expressions.push(arg);

                this.skipWhitespaceAndComments();
                if (this.current().kind === "Punctuation" && this.current().text === ",") {
                    this.advance();
                }

                if (this.position <= beforePos) {
                    break;
                }
            }

            this.skipWhitespaceAndComments();
            if (this.current().kind === "Punctuation" && this.current().text === ")") {
                closeParenEnd = this.current().end;
                this.advance(); // consume ')'
            } else {
                this.addError("Expected ')' after argument list", this.current().start, this.current().end);
            }
        }

        return { expressions, closeParenEnd };
    }

    public parseIndexExpression(target: Syntax.GSExpression): Syntax.GSIndexExpression {
        this.advance(); // consume '['
        this.skipWhitespaceAndComments();
        const index = this.parseExpression();
        this.skipWhitespaceAndComments();
        let end = index.end;
        if (this.current().kind === "Punctuation" && this.current().text === "]") {
            end = this.current().end;
            this.advance(); // consume ']'
        } else {
            this.addError("Expected ']' after index", index.end, this.current().start);
        }
        return {
            kind: "IndexExpression",
            target,
            index,
            start: target.start,
            end
        };
    }

    // ==========================================
    // 5. Expressions and Precedence
    // ==========================================

    private getBinaryPrecedence(op: string): Precedence {
        switch (op) {
            case "||":
                return Precedence.Or;
            case "&&":
                return Precedence.And;
            case "==":
            case "!=":
                return Precedence.Equality;
            case "<":
            case "<=":
            case ">":
            case ">=":
                return Precedence.Relational;
            case "+":
            case "-":
                return Precedence.Additive;
            case "*":
            case "/":
            case "%":
                return Precedence.Multiplicative;
            default:
                return Precedence.None;
        }
    }

    public parseExpression(minPrecedence: Precedence = Precedence.None): Syntax.GSExpression {
        let left = this.parsePrimary();
        return this.parseExpressionWithLeft(left, minPrecedence);
    }

    private parseExpressionWithLeft(left: Syntax.GSExpression, minPrecedence: Precedence = Precedence.None): Syntax.GSExpression {
        while (!this.isAtEnd()) {
            const tok = this.current();
            if (tok.kind !== "Operator") {
                break;
            }

            const op = tok.text;
            const prec = this.getBinaryPrecedence(op);
            if (prec <= minPrecedence) {
                break;
            }

            this.advance(); // consume operator
            const right = this.parseExpression(prec);
            left = {
                kind: "BinaryExpression",
                left,
                operator: op,
                right,
                start: left.start,
                end: right.end
            };
        }

        return left;
    }

    private parsePrimary(): Syntax.GSExpression {
        const tok = this.current();

        // 1. Unary operators: !, -, +
        if (tok.kind === "Operator" && (tok.text === "!" || tok.text === "-" || tok.text === "+")) {
            const opTok = this.advance();
            const operand = this.parseExpression(Precedence.Unary);
            return {
                kind: "UnaryExpression",
                operator: opTok.text,
                operand,
                start: opTok.start,
                end: operand.end
            };
        }

        // 2. Number literal
        if (tok.kind === "Number") {
            this.advance();
            const isFloat = tok.text.includes(".");
            const value = isFloat ? parseFloat(tok.text) : parseInt(tok.text, 10);
            return {
                kind: "LiteralExpression",
                value,
                raw: tok.text,
                start: tok.start,
                end: tok.end
            };
        }

        // 3. String literal
        if (tok.kind === "String") {
            this.advance();
            let value = tok.text;
            if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
                value = value.slice(1, -1);
            }
            return {
                kind: "LiteralExpression",
                value,
                raw: tok.text,
                start: tok.start,
                end: tok.end
            };
        }

        // 4. Grouping: ( expr )
        if (tok.kind === "Punctuation" && tok.text === "(") {
            const openParen = this.advance();
            this.skipWhitespaceAndComments();
            const expr = this.parseExpression();
            this.skipWhitespaceAndComments();
            let end = expr.end;
            if (this.current().kind === "Punctuation" && this.current().text === ")") {
                end = this.current().end;
                this.advance();
            } else {
                this.addError("Expected ')'", expr.end, this.current().start);
            }
            let result: Syntax.GSExpression = {
                kind: "GroupExpression",
                expression: expr,
                start: openParen.start,
                end
            };
            while (this.current().kind === "Punctuation" && this.current().text === "[") {
                result = this.parseIndexExpression(result);
            }
            return result;
        }

        // 5. in / out paths
        if (tok.kind === "Identifier" && (tok.text === "in" || tok.text === "out")) {
            let result: Syntax.GSExpression = this.parsePathExpression();
            while (this.current().kind === "Punctuation" && this.current().text === "[") {
                result = this.parseIndexExpression(result);
            }
            return result;
        }

        // 6. var / param variable reference
        if (tok.kind === "Identifier" && (tok.text === "var" || tok.text === "param")) {
            const prefix = tok.text as "var" | "param";
            const prefixTok = this.advance();
            let name = "";
            let end = prefixTok.end;
            if (this.current().kind === "Identifier" && this.current().line === prefixTok.line) {
                const nameTok = this.advance();
                name = nameTok.text;
                end = nameTok.end;
            } else {
                this.addError(`Expected variable name after '${prefix}'`, prefixTok.start, prefixTok.end);
            }

            let result: Syntax.GSExpression = {
                kind: "VariableExpression",
                prefix,
                name,
                start: prefixTok.start,
                end
            };

            while (this.current().kind === "Punctuation" && this.current().text === "[") {
                result = this.parseIndexExpression(result);
            }
            return result;
        }

        // 7. Boolean and null literals, function calls, bare identifiers
        if (tok.kind === "Identifier") {
            if (tok.text === "true" || tok.text === "false") {
                this.advance();
                return {
                    kind: "LiteralExpression",
                    value: tok.text === "true",
                    raw: tok.text,
                    start: tok.start,
                    end: tok.end
                };
            }
            if (tok.text === "null") {
                this.advance();
                return {
                    kind: "LiteralExpression",
                    value: null,
                    raw: tok.text,
                    start: tok.start,
                    end: tok.end
                };
            }

            // Function call: floor (var rps_totals / var len_frac)
            if (this.peek().kind === "Punctuation" && this.peek().text === "(") {
                const nameTok = this.advance();
                const args = this.parseArgumentList();
                const end = args.closeParenEnd ?? nameTok.end;
                let result: Syntax.GSExpression = {
                    kind: "CallExpression",
                    name: nameTok.text,
                    arguments: args.expressions,
                    start: nameTok.start,
                    end
                };
                while (this.current().kind === "Punctuation" && this.current().text === "[") {
                    result = this.parseIndexExpression(result);
                }
                return result;
            }

            // Bare identifier
            const nameTok = this.advance();
            this.addError(`Unexpected identifier '${nameTok.text}'; variables must be prefixed with 'var' or 'param' (e.g. 'var ${nameTok.text}')`, nameTok.start, nameTok.end);
            let result: Syntax.GSExpression = {
                kind: "IdentifierExpression",
                name: nameTok.text,
                start: nameTok.start,
                end: nameTok.end
            };
            while (this.current().kind === "Punctuation" && this.current().text === "[") {
                result = this.parseIndexExpression(result);
            }
            return result;
        }

        // Fallback error recovery
        this.addError(`Unexpected token in expression: '${tok.text}'`, tok.start, tok.end);
        const fallback: Syntax.GSExpression = {
            kind: "LiteralExpression",
            value: null,
            start: tok.start,
            end: tok.end
        };
        this.advance();
        return fallback;
    }
}

export function parseProgram(input: GSToken[] | string): GSParseResult {
    let tokens: GSToken[];
    let source: string | undefined;
    if (typeof input === "string") {
        source = input;
        let res: GSLexResult = lex(input);
        tokens = res.tokens;
    } else {
        tokens = input;
    }
    const parser = new GSParser(tokens, source);
    return parser.parseGSProgram();
}

