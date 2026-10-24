import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { lex } from "../extension/src/language/lexer";
import { parseProgram } from "../extension/src/language/parser";
import { preprocessScript } from "../extension/src/language/preprocess";
import { checkComponents, ComponentState } from "../extension/src/server/componentChecks";

const URI = "file:///a.geoscript";

function run(source: string, context: { id: string; alias?: string }[]) {
    const state = new ComponentState();
    state.setRegistry([
        { name: "engine_id", displayName: "Engine", pins: [
            { name: "rps", type: "f64", direction: "output" },
            { name: "throttle", type: "f64", direction: "input" },
        ] },
        { name: "lcd_id", displayName: "7 Segment LCD Display", pins: [
            { name: "display_value", type: "s32", direction: "input" },
        ] },
    ]);
    state.setContexts({ hasWorkspace: true, contexts: { [URI]: context } });
    const doc = TextDocument.create(URI, "geoscript", 1, source);
    const program = parseProgram(lex(preprocessScript(source)).tokens, source).program;
    return checkComponents(program, doc, state);
}

describe("component checks", () => {
    it("warns for missing component with a fix, none for aliases", () => {
        const d = run("on_tick\n{\n\tvar x = out Engine.rps\n\tvar y = out careng.rps\n}", []);
        const warnings = d.filter(x => x.severity === 2);
        expect(warnings).toHaveLength(2);
        expect(warnings[0].data).toMatchObject({ componentId: "engine_id" });
        expect(warnings[1].data).toBeUndefined();
    });

    it("accepts multi-word names and aliases in context", () => {
        const d = run("on_tick\n{\n\tin 7 Segment LCD Display.display_value = 1\n\tvar x = out careng.rps\n}",
            [{ id: "lcd_id" }, { id: "engine_id", alias: "careng" }]);
        expect(d).toHaveLength(0);
    });

    it("reports unknown pins and direction misuse", () => {
        const d = run("on_tick\n{\n\tvar a = out Engine.nope\n\tout Engine.rps = 1\n\tvar b = out Engine.throttle\n}",
            [{ id: "engine_id" }]);
        expect(d.map(x => x.message)).toEqual([
            'Component "Engine" has no value named "nope"',
            'Cannot write to "rps": it is a read-only output',
            'Cannot read "throttle": it is a write-only input',
        ]);
    });
});
