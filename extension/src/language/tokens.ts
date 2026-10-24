import { GSProgram } from "./syntax";

export type GSTokenKind = 
    | "Identifier"
    | "Number"
    | "String"
    | "Comment"
    | "Whitespace"
    | "Newline"
    | "Operator"
    | "Punctuation"
    | "Unknown"
    | "EOF";

export interface GSToken {
    kind: GSTokenKind;
    text: string;

    // Character offsets in the original source text
    start: number;
    end: number;

    // Zero-based source line and column numbers
    line: number;
    column: number;
}

export interface GSLexResult {
    tokens: GSToken[];
    errors: GSLexError[];
}

export interface GSLexError {
    message: string;
    start: number;
    end: number;
    line: number;
    column: number;
}

export interface GSParseResult {
    program: GSProgram;
    errors: GSParseError[];
}

export interface GSParseError {
    message: string;
    start: number;
    end: number;
}
