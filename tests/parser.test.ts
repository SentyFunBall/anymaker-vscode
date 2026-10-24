import { describe, expect, it } from "vitest";
import * as fs from "fs";
import { lex } from "../extension/src/language/lexer";
import { GSParser, parseProgram } from "../extension/src/language/parser";
import * as Syntax from "../extension/src/language/syntax";

const RPSAVG_SCRIPT = `define var fractional rps_totals
define list fractional rps_list
define var fractional rps_avg
define function count (integer i)
{
	var rps_totals = var rps_totals + floor (var rps_list[param i])
}
on_tick
{
	var rps_list append (out Engine.rps)
	if (len (var rps_list) > 60)
	{
		var rps_list erase (0)
	}
	define var integer i
	define var fractional len_frac
	var i = 0
	var len_frac = 0.0
	var rps_totals = 0.0
	foreach (var rps_list)
	{
		var i = var i + 1
		var len_frac = var len_frac + 1.0
		call count (var i)
	}
	#this sucks
	var rps_avg = floor (var rps_totals / var len_frac)
	in 7 Segment LCD Display.display_value = var rps_avg
}
`;

const AUTOTRANS2_SCRIPT = `define var fractional currps
define var fractional uprps
define var fractional dnrps
define var integer motortimer
var motortimer = 0
define var integer selectortimer
var selectortimer = 0
define var bool pulse
var pulse = false
define var integer mode
var mode = 0
define var fractional gear_f
on_tick
{
	#Gear timers
	if (var selectortimer > 0)
	{
		var selectortimer = var selectortimer + 1
	}
	if (var selectortimer == 60)
	{
		var selectortimer = 60
	}
	if (var motortimer > 0)
	{
		var motortimer = var motortimer + 1
	}
	if (var motortimer == 60)
	{
		var motortimer = 0
	}
	var gear_f = to_fractional (out Gearbox.current_gear)
	#Clamp targ -1..1
	if ((out Gear_Selecter.throttle == 1.0) && ! (var pulse))
	{
		var mode = var mode + 1
		if (var mode == 2)
		{
			var mode = 1
		}
		var pulse = true
	}
	if ((out Gear_Selecter.throttle == -1.0) && ! (var pulse))
	{
		var mode = var mode - 1
		if (var mode == -2)
		{
			var mode = -1
		}
		var pulse = true
	}
	if (out Gear_Selecter.throttle == 0.0)
	{
		var pulse = false
	}
	#Depend on mode
	#Do automatic
	in Gear_motor.input = 0.0
	if (var mode == 0)
	{
		#Neutral
		if ((out Gearbox.current_gear > 0) && (var motortimer == 0))
		{
			in Gear_motor.input = -1.0
			var motortimer = 1
		}
		if ((out Gearbox.current_gear < 0) && (var motortimer == 0))
		{
			in Gear_motor.input = 1.0
			var motortimer = 1
		}
	}
	elseif (var mode == -1)
	{
		#Reverse
		if ((out Gearbox.current_gear > -1) && (var motortimer == 0))
		{
			in Gear_motor.input = -1.0
			var motortimer = 1
		}
	}
	else
	{
		#Drive fuck me
		var currps = out Engine.rps
		var uprps = 54.0
		var dnrps = 19.0
		if ((var currps > var uprps) && (var motortimer == 0))
		{
			in Gear_motor.input = 1.0
			var motortimer = 1
		}
		if (((var currps < var dnrps) && (var motortimer == 0)) && (out Gearbox.current_gear > 1))
		{
			in Gear_motor.input = -1.0
			var motortimer = 1
		}
		if (out Gearbox.current_gear == 0)
		{
			in Gear_motor.input = 1.0
		}
	}
	#Set displays
	in Gear.display_value = to_fractional (out Gearbox.current_gear)
	in RPS.display_value = out Engine.rps
	in Is_reverse.is_illuminated = out Gearbox.current_gear == -1
}
`;

describe("GeoScript Parser", () => {
    describe("1. Token utilities and program parsing", () => {
        it("includes comments in CST statements while skipping them for syntax decisions", () => {
            const source = `
                # Leading comment
                var x = 10 # inline comment
                # Interstitial comment
                var y = 20
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            expect(result.program.statements).toHaveLength(5);
            expect(result.program.statements[0].kind).toBe("CommentStatement");
            expect((result.program.statements[0] as Syntax.GSCommentStatement).text).toBe("# Leading comment");
            expect((result.program.statements[0] as Syntax.GSCommentStatement).value).toBe("Leading comment");

            expect(result.program.statements[1].kind).toBe("AssignmentStatement");

            expect(result.program.statements[2].kind).toBe("CommentStatement");
            expect((result.program.statements[2] as Syntax.GSCommentStatement).text).toBe("# inline comment");
            expect((result.program.statements[2] as Syntax.GSCommentStatement).value).toBe("inline comment");

            expect(result.program.statements[3].kind).toBe("CommentStatement");
            expect(result.program.statements[4].kind).toBe("AssignmentStatement");

            expect(result.program.comments).toHaveLength(3);
        });

        it("tracks source ranges on all nodes", () => {
            const source = "var x = 42";
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            expect(stmt.start).toBe(0);
            expect(stmt.end).toBe(10);
            expect(source.slice(stmt.start, stmt.end)).toBe("var x = 42");

            expect(stmt.target.start).toBe(0);
            expect(stmt.target.end).toBe(5);
            expect(source.slice(stmt.target.start, stmt.target.end)).toBe("var x");

            expect(stmt.value.start).toBe(8);
            expect(stmt.value.end).toBe(10);
            expect(source.slice(stmt.value.start, stmt.value.end)).toBe("42");
        });
    });

    describe("2. Blocks and control flow", () => {
        it("parses block statements and nested blocks", () => {
            const source = `{ { var a = 1 } var b = 2 }`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            expect(result.program.statements).toHaveLength(1);
            const outer = result.program.statements[0] as Syntax.GSBlockStatement;
            expect(outer.kind).toBe("BlockStatement");
            expect(outer.statements).toHaveLength(2);
            expect(outer.statements[0].kind).toBe("BlockStatement");
            expect(outer.statements[1].kind).toBe("AssignmentStatement");
        });

        it("parses if, elseif, and else branches", () => {
            const source = `
                if (var x == 1) {
                    var y = 10
                } elseif (var x == 2) {
                    var y = 20
                } else {
                    var y = 30
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const ifStmt = result.program.statements[0] as Syntax.GSIfStatement;
            expect(ifStmt.kind).toBe("IfStatement");
            expect(ifStmt.elseIfBranches).toHaveLength(1);
            expect(ifStmt.elseBody).toBeDefined();
            expect(ifStmt.elseBody?.statements).toHaveLength(1);
        });

        it("parses foreach loop", () => {
            const source = `
                foreach (var my_list) {
                    var i = var i + 1
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const foreachStmt = result.program.statements[0] as Syntax.GSForeachStatement;
            expect(foreachStmt.kind).toBe("ForeachStatement");
            expect(foreachStmt.iterable.kind).toBe("VariableExpression");
            expect(foreachStmt.body.statements).toHaveLength(1);
        });

        it("reports missing-brace diagnostics for unclosed block", () => {
            const source = `
                on_tick {
                    var x = 1
            `;
            const result = parseProgram(source);
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
            const braceErr = result.errors.find(e => e.message.includes("Expected '}'"));
            expect(braceErr).toBeDefined();
        });

        it("reports missing-brace diagnostics for missing open brace", () => {
            const source = `
                if (var x == 1)
                    var y = 2
            `;
            const result = parseProgram(source);
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
            const braceErr = result.errors.find(e => e.message.includes("Expected '{'"));
            expect(braceErr).toBeDefined();
        });
    });

    describe("3. Expressions and assignments", () => {
        it("parses literals: number, string, boolean, null", () => {
            const source = `
                var a = 123
                var b = 45.67
                var c = "hello"
                var d = true
                var e = false
                var f = null
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmts = result.program.statements as Syntax.GSAssignmentStatement[];
            expect((stmts[0].value as Syntax.GSLiteralExpression).value).toBe(123);
            expect((stmts[1].value as Syntax.GSLiteralExpression).value).toBe(45.67);
            expect((stmts[2].value as Syntax.GSLiteralExpression).value).toBe("hello");
            expect((stmts[3].value as Syntax.GSLiteralExpression).value).toBe(true);
            expect((stmts[4].value as Syntax.GSLiteralExpression).value).toBe(false);
            expect((stmts[5].value as Syntax.GSLiteralExpression).value).toBe(null);
        });

        it("parses unary operators !, -, +", () => {
            const source = `
                var a = ! (var pulse)
                var b = -1.0
                var c = +5
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmts = result.program.statements as Syntax.GSAssignmentStatement[];
            expect((stmts[0].value as Syntax.GSUnaryExpression).operator).toBe("!");
            expect((stmts[1].value as Syntax.GSUnaryExpression).operator).toBe("-");
            expect((stmts[2].value as Syntax.GSUnaryExpression).operator).toBe("+");
        });

        it("respects operator precedence: multiplication before addition", () => {
            const source = `var x = 1 + 2 * 3`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            const bin = stmt.value as Syntax.GSBinaryExpression;
            expect(bin.operator).toBe("+");
            expect((bin.left as Syntax.GSLiteralExpression).value).toBe(1);
            expect((bin.right as Syntax.GSBinaryExpression).operator).toBe("*");
        });

        it("respects operator precedence: comparison before logical AND", () => {
            const source = `var x = var a > 0 && var b < 10`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            const bin = stmt.value as Syntax.GSBinaryExpression;
            expect(bin.operator).toBe("&&");
            expect((bin.left as Syntax.GSBinaryExpression).operator).toBe(">");
            expect((bin.right as Syntax.GSBinaryExpression).operator).toBe("<");
        });

        it("parses parenthesized group expressions", () => {
            const source = `var x = (1 + 2) * 3`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            const bin = stmt.value as Syntax.GSBinaryExpression;
            expect(bin.operator).toBe("*");
            expect(bin.left.kind).toBe("GroupExpression");
        });

        it("parses complex nested expressions and chained binary operations", () => {
            const source = `var res = ((out Gear_Selecter.throttle == 1.0) && ! (var pulse))`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            expect(stmt.value.kind).toBe("GroupExpression");
            const inner = (stmt.value as Syntax.GSGroupExpression).expression as Syntax.GSBinaryExpression;
            expect(inner.operator).toBe("&&");
            expect(inner.left.kind).toBe("GroupExpression");
            expect(inner.right.kind).toBe("UnaryExpression");
        });

        it("handles binary minus and unary minus correctly", () => {
            const source = `var diff = var a - -5`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const stmt = result.program.statements[0] as Syntax.GSAssignmentStatement;
            const bin = stmt.value as Syntax.GSBinaryExpression;
            expect(bin.operator).toBe("-");
            expect(bin.right.kind).toBe("UnaryExpression");
            expect((bin.right as Syntax.GSUnaryExpression).operator).toBe("-");
        });
    });

    describe("4. GeoScript-specific syntax", () => {
        it("parses variable and list declarations", () => {
            const source = `
                define var fractional rps_totals
                define list fractional rps_list
                define var integer i
                define var fractional thr = 2.0
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            expect(result.program.statements).toHaveLength(4);

            const s1 = result.program.statements[0] as Syntax.GSDeclarationStatement;
            expect(s1.declarationType).toBe("var");
            expect(s1.dataType).toBe("fractional");
            expect(s1.name).toBe("rps_totals");

            const s2 = result.program.statements[1] as Syntax.GSDeclarationStatement;
            expect(s2.declarationType).toBe("list");
            expect(s2.dataType).toBe("fractional");
            expect(s2.name).toBe("rps_list");

            const s4 = result.program.statements[3] as Syntax.GSDeclarationStatement;
            expect(s4.initializer).toBeDefined();
            expect((s4.initializer as Syntax.GSLiteralExpression).value).toBe(2.0);
        });

        it("parses function declaration with parameters and body", () => {
            const source = `
                define function count (integer i)
                {
                    var rps_totals = var rps_totals + 1
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const func = result.program.statements[0] as Syntax.GSDeclarationStatement;
            expect(func.kind).toBe("DeclarationStatement");
            expect(func.declarationType).toBe("function");
            expect(func.name).toBe("count");
            expect(func.parameters).toHaveLength(1);
            expect(func.parameters?.[0].dataType).toBe("integer");
            expect(func.parameters?.[0].name).toBe("i");
            expect(func.body?.statements).toHaveLength(1);
        });

        it("parses call statement and expression calls", () => {
            const source = `
                call count (var i)
                var x = floor (var rps_totals / var len_frac)
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);

            const callStmt = result.program.statements[0] as Syntax.GSCallStatement;
            expect(callStmt.kind).toBe("CallStatement");
            expect(callStmt.name).toBe("count");
            expect(callStmt.arguments).toHaveLength(1);

            const assign = result.program.statements[1] as Syntax.GSAssignmentStatement;
            expect(assign.value.kind).toBe("CallExpression");
            expect((assign.value as Syntax.GSCallExpression).name).toBe("floor");
        });

        it("parses event handlers", () => {
            const source = `
                on_tick
                {
                    var x = 1
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const eventStmt = result.program.statements[0] as Syntax.GSEventStatement;
            expect(eventStmt.kind).toBe("EventStatement");
            expect(eventStmt.name).toBe("on_tick");
            expect(eventStmt.body.statements).toHaveLength(1);
        });

        it("parses in/out paths with multiword block names", () => {
            const source = `
                in 7 Segment LCD Display.display_value = var rps_avg
                var x = out Engine.rps
                var y = out Gearbox.current_gear
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);

            const assign1 = result.program.statements[0] as Syntax.GSAssignmentStatement;
            const path1 = assign1.target as Syntax.GSPathExpression;
            expect(path1.kind).toBe("PathExpression");
            expect(path1.direction).toBe("in");
            expect(path1.target).toBe("7 Segment LCD Display");
            expect(path1.pin).toBe("display_value");

            const assign2 = result.program.statements[1] as Syntax.GSAssignmentStatement;
            const path2 = assign2.value as Syntax.GSPathExpression;
            expect(path2.direction).toBe("out");
            expect(path2.target).toBe("Engine");
            expect(path2.pin).toBe("rps");
        });

        it("parses list operations (append, erase) and list index expressions", () => {
            const source = `
                var rps_list append (out Engine.rps)
                var rps_list erase (0)
                var val = var rps_list[param i]
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);

            const appendStmt = result.program.statements[0] as Syntax.GSListOperationStatement;
            expect(appendStmt.kind).toBe("ListOperationStatement");
            expect(appendStmt.operation).toBe("append");
            expect(appendStmt.arguments).toHaveLength(1);

            const eraseStmt = result.program.statements[1] as Syntax.GSListOperationStatement;
            expect(eraseStmt.kind).toBe("ListOperationStatement");
            expect(eraseStmt.operation).toBe("erase");
            expect(eraseStmt.arguments).toHaveLength(1);

            const assign = result.program.statements[2] as Syntax.GSAssignmentStatement;
            expect(assign.value.kind).toBe("IndexExpression");
            const indexExpr = assign.value as Syntax.GSIndexExpression;
            expect(indexExpr.target.kind).toBe("VariableExpression");
            expect(indexExpr.index.kind).toBe("VariableExpression");
        });

        it("parses list operations with dot syntax", () => {
            const source = `var rps_list.append(out Engine.rps)`;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const appendStmt = result.program.statements[0] as Syntax.GSListOperationStatement;
            expect(appendStmt.kind).toBe("ListOperationStatement");
            expect(appendStmt.operation).toBe("append");
        });

        it("parses functions with multiple parameters and zero parameters", () => {
            const source = `
                define function add (fractional a, fractional b) {
                    var sum = param a + param b
                }
                define function noop () {}
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            expect(result.program.statements).toHaveLength(2);

            const fn1 = result.program.statements[0] as Syntax.GSDeclarationStatement;
            expect(fn1.parameters).toHaveLength(2);
            expect(fn1.parameters?.[0].name).toBe("a");
            expect(fn1.parameters?.[1].name).toBe("b");

            const fn2 = result.program.statements[1] as Syntax.GSDeclarationStatement;
            expect(fn2.parameters).toHaveLength(0);
        });

        it("parses while loops", () => {
            const source = `
                while (var x > 0) {
                    var x = var x - 1
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const whileStmt = result.program.statements[0] as Syntax.GSWhileStatement;
            expect(whileStmt.kind).toBe("WhileStatement");
            expect(whileStmt.condition.kind).toBe("BinaryExpression");
            expect(whileStmt.body.statements).toHaveLength(1);
        });
    });

    describe("5. Tests and recovery", () => {
        it("parses rpsavg.txt successfully with 0 errors", () => {
            const result = parseProgram(RPSAVG_SCRIPT);
            expect(result.errors).toEqual([]);
            expect(result.program.statements.length).toBeGreaterThan(0);
        });

        it("parses autotrans2.txt successfully with 0 errors", () => {
            const result = parseProgram(AUTOTRANS2_SCRIPT);
            expect(result.errors).toEqual([]);
            expect(result.program.statements.length).toBeGreaterThan(0);
        });

        it("parses actual files from disk if available", () => {
            const paths = [
                "c:\\Users\\senty\\AppData\\Roaming\\Anymaker\\scripts\\rpsavg.txt",
                "c:\\Users\\senty\\AppData\\Roaming\\Anymaker\\scripts\\autotrans2.txt"
            ];
            for (const p of paths) {
                if (fs.existsSync(p)) {
                    const content = fs.readFileSync(p, "utf-8");
                    const result = parseProgram(content);
                    expect(result.errors.filter(e => !e.message.startsWith("Unexpected identifier"))).toEqual([]);
                    expect(result.program.statements.length).toBeGreaterThan(0);
                }
            }
        });

        it("recovers from malformed inputs and always makes progress", () => {
            const malformedCases = [
                "@@@@ !!!! %%%%",
                "define",
                "define var",
                "var x =",
                "if (",
                "if (x > 0",
                "call",
                "foreach (",
                "in .display_value = 1",
                "out",
                "{ { { {",
                "} } } }",
                "define function ( ) { }",
                "var a = 1 + * 2"
            ];

            for (const malformed of malformedCases) {
                const startTime = Date.now();
                const result = parseProgram(malformed);
                const duration = Date.now() - startTime;

                // Guaranteed to finish fast, not hanging in infinite loop
                expect(duration).toBeLessThan(1000);
                expect(result).toBeDefined();
                expect(result.program).toBeDefined();
                // Should record error for malformed input
                expect(result.errors.length).toBeGreaterThan(0);
            }
        });
    });

    describe("6. Comments in CST", () => {
        it("preserves comments inside block statements", () => {
            const source = `
                on_tick {
                    # inside block comment
                    var x = 1
                    # trailing block comment
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const eventStmt = result.program.statements[0] as Syntax.GSEventStatement;
            expect(eventStmt.body.statements).toHaveLength(3);
            expect(eventStmt.body.statements[0].kind).toBe("CommentStatement");
            expect((eventStmt.body.statements[0] as Syntax.GSCommentStatement).value).toBe("inside block comment");
            expect(eventStmt.body.statements[1].kind).toBe("AssignmentStatement");
            expect(eventStmt.body.statements[2].kind).toBe("CommentStatement");
            expect((eventStmt.body.statements[2] as Syntax.GSCommentStatement).value).toBe("trailing block comment");
        });

        it("preserves comments between if, elseif, and else branches", () => {
            const source = `
                if (var x == 1) {
                    var y = 1
                }
                # comment before elseif
                elseif (var x == 2) {
                    var y = 2
                }
                # comment before else
                else {
                    var y = 3
                }
            `;
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            const ifStmt = result.program.statements[0] as Syntax.GSIfStatement;
            expect(ifStmt.kind).toBe("IfStatement");
            expect(ifStmt.elseIfBranches).toHaveLength(1);
            expect(ifStmt.elseBody).toBeDefined();
            expect(result.program.comments?.length).toBeGreaterThanOrEqual(2);
        });

        it("preserves comments inside autotrans2.txt in the CST", () => {
            const result = parseProgram(AUTOTRANS2_SCRIPT);
            expect(result.errors).toHaveLength(0);
            // autotrans2.txt has 8 comments
            expect(result.program.comments).toHaveLength(8);

            // Find comments inside on_tick body
            const onTick = result.program.statements.find(s => s.kind === "EventStatement") as Syntax.GSEventStatement;
            expect(onTick).toBeDefined();
            const blockComments = onTick.body.statements.filter(s => s.kind === "CommentStatement");
            expect(blockComments.length).toBeGreaterThan(0);
        });

        it("preserves comment in rpsavg.txt in the CST", () => {
            const result = parseProgram(RPSAVG_SCRIPT);
            expect(result.errors).toHaveLength(0);
            expect(result.program.comments).toHaveLength(1);
            expect(result.program.comments?.[0].value).toBe("this sucks");
        });

        it("tracks accurate source ranges on comment statements", () => {
            const source = "  # sample comment  ";
            const result = parseProgram(source);
            expect(result.errors).toHaveLength(0);
            expect(result.program.statements).toHaveLength(1);
            const c = result.program.statements[0] as Syntax.GSCommentStatement;
            expect(c.kind).toBe("CommentStatement");
            expect(c.text).toBe("# sample comment  ");
            expect(source.slice(c.start, c.end)).toBe("# sample comment  ");
        });
    });
});

describe("GeoScript Parser strict statement errors", () => {
    const invalid: [string, string][] = [
        ["define function count (i, j, k)", "Expected data type before parameter 'i'"],
        ["function count(integer i)", "Unexpected keyword 'function'"],
        ["define function count(integer)", "Expected parameter name"],
        ["hi mom", "Unexpected token: 'hi'"],
        ["let t", "Unexpected statement 'let'"],
        ["var erase (0)", "requires a target"],
        ["foreach (bbb) {}", "'var'"],
        ["in display.display_value = avg", "'var'"],
        ["define var t", "Missing data type"],
        ["define fractional t", "Expected 'var' or 'list'"],
        ["var t", "Missing declaration"],
        ["fractional t", "Unexpected type 'fractional'"],
    ];
    for (const [src, msg] of invalid) {
        it(`reports error for: ${src}`, () => {
            const result = parseProgram(src);
            expect(result.errors.some(e => e.message.includes(msg))).toBe(true);
        });
    }

    it("accepts valid forms", () => {
        const src = `define function count (integer i, fractional k, bool m) {}
define var fractional t
var rps_values erase (0)
foreach (var bbb) {}
in display.display_value = var avg`;
        expect(parseProgram(src).errors).toEqual([]);
    });
});
