import type { GSToken, GSTokenKind, GSLexResult, GSLexError } from "./tokens";

const MULTI_CHAR_OPERATIONS = [
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||"
] as const;

const SINGLE_CHAR_OPERATIONS = new Set([
    "+",
    "-",
    "*",
    "/",
    "%",
    "=",
    "<",
    ">",
    "!"
]);

const PUNCTUATIONS = new Set([
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    ";",
    ",",
    "."
]);

export function lex(source: string): GSLexResult {
    const tokens: GSToken[] = [];
    const errors: GSLexError[] = [];

    let offset = 0;
    let line = 0;
    let column = 0;

    // Utility functions for lexing
    function peek(distance = 0): string {
        return source[offset + distance] ?? "";
    }

    function advance(): string {
        const char = source[offset++];

        if (char === "\n") {
            line++;
            column = 0;
        } else {
            column++;
        }

        return char;
    }

    function emit(kind: GSTokenKind, start: number, end: number, startLine: number, startColumn: number) {
        tokens.push({
            kind,
            text: source.slice(start, end),
            start,
            end,
            line: startLine,
            column: startColumn,
        });
    }

    function isIdentifierStart(char: string): boolean {
        return /[a-zA-Z_]/.test(char);
    }

    function isIdentifierPart(char: string): boolean {
        return /[a-zA-Z0-9_]/.test(char);
    }

    function isDigit(char: string): boolean {
        return /[0-9]/.test(char);
    }

    while (offset < source.length) {
        const start = offset;
        const startLine = line;
        const startColumn = column;
        const char = peek();

        // Newlines: preserve CRLF as a single token
        if (char === "\r" || char === "\n") {
            if (char === "\r" && peek(1) === "\n") {
                advance();
                advance();
            } else {
                advance();
            }

            emit("Newline", start, offset, startLine, startColumn);
            continue;
        }

        // Horizontal whitespace
        if (char === " " || char === "\t") {
            while (peek() === " " || peek() === "\t") {
                advance();
            }

            emit("Whitespace", start, offset, startLine, startColumn);
            continue;
        }

        // Comments run to the end of the line
        if (char === "#") {
            while (peek() !== "" && peek() !== "\r" && peek() !== "\n") {
                advance();
            }

            emit("Comment", start, offset, startLine, startColumn);
            continue;
        }

        // Quoted strings including escape sequences
        if (char === '"') {
            advance();

            let terminated = false;

            while (peek() !== "") {
                if (peek() === "\\") {
                    advance();

                    // Consume escaped character if it exists
                    if (peek() !== "") {
                        advance();
                    }

                    continue;
                }

                if (peek() === '"') {
                    advance();
                    terminated = true;
                    break;
                }

                // Don't consume a physical newline in the comment
                if (peek() === "\n" || peek() === "\r") {
                    break;
                }

                advance();
            }

            emit("String", start, offset, startLine, startColumn);

            if (!terminated) {
                errors.push({
                    message: "Unterminated string",
                    start,
                    end: offset,
                    line: startLine,
                    column: startColumn,
                });
            }

            continue;
        }

        // Identifiers: define, fractional, on_tick, rps_list, etc
        if (isIdentifierStart(char)) {
            advance();
            while (isIdentifierPart(peek())) {
                advance();
            }

            emit("Identifier", start, offset, startLine, startColumn);
            continue;
        }

        // Numbers: integers and floating-point numbers
        // A leading minus is a separate operator
        if (isDigit(char)) {
            while(isDigit(peek())) {
                advance();
            }

            // Check for a fractional part
            if (peek() === "." && isDigit(peek(1))) {
                advance(); // consume the dot
                while (isDigit(peek())) {
                    advance();
                }
            }

            emit("Number", start, offset, startLine, startColumn);
            continue;
        }

        // Prefer the longest matching operator
        const operator = MULTI_CHAR_OPERATIONS.find(candidate => source.startsWith(candidate, start));
        if (operator) {
            for (let i = 0; i < operator.length; i++) {
                advance();
            }
            emit("Operator", start, offset, startLine, startColumn);
            continue;
        }

        if (SINGLE_CHAR_OPERATIONS.has(char)) {
            advance();
            emit("Operator", start, offset, startLine, startColumn);
            continue;
        }

        if (PUNCTUATIONS.has(char)) {
            advance();
            emit("Punctuation", start, offset, startLine, startColumn);
            continue;
        }

        // Keep unknown characters visible instead of losing source text
        advance();
        emit("Unknown", start, offset, startLine, startColumn);

        errors.push({
            message: "Unknown character: " + char,
            start,
            end: offset,
            line: startLine,
            column: startColumn,
        });
    }

    tokens.push({
        kind: "EOF",
        text: "",
        start: offset,
        end: offset,
        line: line,
        column: column,
    });

    return { tokens, errors };
}