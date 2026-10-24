export interface GSNodeBase {
    start: number;
    end: number;
}

export interface GSProgram extends GSNodeBase {
    kind: "Program";
    statements: GSStatement[];
    comments?: GSCommentStatement[];
}

export type GSStatement =
    | GSBlockStatement
    | GSIfStatement
    | GSDeclarationStatement
    | GSAssignmentStatement
    | GSCallStatement
    | GSForeachStatement
    | GSWhileStatement
    | GSEventStatement
    | GSListOperationStatement
    | GSCommentStatement
    | GSExpressionStatement
    | GSUnknownStatement;

export interface GSCommentStatement extends GSNodeBase {
    kind: "CommentStatement";
    text: string;
    value?: string;
}

export type GSComment = GSCommentStatement;

export interface GSBlockStatement extends GSNodeBase {
    kind: "BlockStatement";
    statements: GSStatement[];
}

export interface GSIfStatement extends GSNodeBase {
    kind: "IfStatement";
    condition: GSExpression;
    body: GSBlockStatement;
    elseIfBranches: {
        condition: GSExpression;
        body: GSBlockStatement;
    }[];
    elseBody?: GSBlockStatement;
}

export interface GSParameter extends GSNodeBase {
    kind: "Parameter";
    dataType: string;
    name: string;
}

export interface GSDeclarationStatement extends GSNodeBase {
    kind: "DeclarationStatement";
    declarationType: string;
    name: string;
    dataType?: string;
    initializer?: GSExpression;
    parameters?: GSParameter[];
    body?: GSBlockStatement;
}

export interface GSAssignmentStatement extends GSNodeBase {
    kind: "AssignmentStatement";
    target: GSExpression;
    value: GSExpression;
}

export interface GSCallStatement extends GSNodeBase {
    kind: "CallStatement";
    name: string;
    arguments: GSExpression[];
}

export interface GSForeachStatement extends GSNodeBase {
    kind: "ForeachStatement";
    iterable: GSExpression;
    body: GSBlockStatement;
}

export interface GSWhileStatement extends GSNodeBase {
    kind: "WhileStatement";
    condition: GSExpression;
    body: GSBlockStatement;
}

export interface GSEventStatement extends GSNodeBase {
    kind: "EventStatement";
    name: string;
    body: GSBlockStatement;
}

export interface GSListOperationStatement extends GSNodeBase {
    kind: "ListOperationStatement";
    target: GSExpression;
    operation: string;
    arguments: GSExpression[];
}

export interface GSExpressionStatement extends GSNodeBase {
    kind: "ExpressionStatement";
    expression: GSExpression;
}

export interface GSUnknownStatement extends GSNodeBase {
    kind: "UnknownStatement";
}

export type GSExpression =
    | GSIdentifierExpression
    | GSVariableExpression
    | GSPathExpression
    | GSLiteralExpression
    | GSUnaryExpression
    | GSBinaryExpression
    | GSCallExpression
    | GSIndexExpression
    | GSGroupExpression;

export interface GSIdentifierExpression extends GSNodeBase {
    kind: "IdentifierExpression";
    name: string;
}

export interface GSVariableExpression extends GSNodeBase {
    kind: "VariableExpression";
    prefix: "var" | "param";
    name: string;
}

export interface GSPathExpression extends GSNodeBase {
    kind: "PathExpression";
    direction: "in" | "out";
    target: string;
    targetParts?: string[];
    pin: string;
    targetStart?: number;
    targetEnd?: number;
    pinStart?: number;
    pinEnd?: number;
}

export interface GSLiteralExpression extends GSNodeBase {
    kind: "LiteralExpression";
    value: string | number | boolean | null;
    raw?: string;
}

export interface GSUnaryExpression extends GSNodeBase {
    kind: "UnaryExpression";
    operator: string;
    operand: GSExpression;
}

export interface GSBinaryExpression extends GSNodeBase {
    kind: "BinaryExpression";
    left: GSExpression;
    operator: string;
    right: GSExpression;
}

export interface GSCallExpression extends GSNodeBase {
    kind: "CallExpression";
    name: string;
    arguments: GSExpression[];
}

export interface GSIndexExpression extends GSNodeBase {
    kind: "IndexExpression";
    target: GSExpression;
    index: GSExpression;
}

export interface GSGroupExpression extends GSNodeBase {
    kind: "GroupExpression";
    expression: GSExpression;
}
