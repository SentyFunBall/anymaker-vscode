
import { describe, expect, it } from "vitest";
import { lex } from "../extension/src/language/lexer";

describe("GeoScript lexer", () => {
    it("recognizes identifiers, types, and numbers", () => {
        const result = lex("define var fractional thr = 2.0");

        expect(result.tokens.map(t => [t.kind, t.text])).toContainEqual(
            ["Identifier", "fractional"],
        );

        expect(result.tokens.map(t => [t.kind, t.text])).toContainEqual(
            ["Number", "2.0"],
        );

        expect(result.errors).toHaveLength(0);
    });

    it("preserves comments and whitespace", () => {
        const source = "\t# comment\nvar x = 1";
        const result = lex(source);

        expect(result.tokens.map(t => t.text).join("")).toBe(source);
        expect(result.errors).toHaveLength(0);
    });

    it("recognizes multi-character operators", () => {
        const result = lex("a == b && c != d");

        expect(
            result.tokens
                .filter(t => t.kind === "Operator")
                .map(t => t.text),
        ).toEqual(["==", "&&", "!="]);
    });

    it("keeps multiword block aliases as separate tokens", () => {
        const result = lex(
            "in 7 Segment LCD Display.display_value = 2.0",
        );

        expect(result.tokens.map(t => t.text)).toContain("Segment");
        expect(result.tokens.map(t => t.text)).toContain("Display");
        expect(result.errors).toHaveLength(0);
    });

    it("reports unterminated strings", () => {
        const result = lex('var x = "unfinished');

        console.log(result.errors);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain("Unterminated string");
    });
});
