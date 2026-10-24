import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AMComponentDefinition } from '../client/componentRegistry';
import { GSPathExpression, GSProgram } from '../language/syntax';

export const NOT_IN_CONTEXT_CODE = 'component-not-in-context';

export interface ContextEntry {
    id: string;
    alias?: string;
}

export interface ContextsMessage {
    hasWorkspace: boolean;
    // Document URI -> components connected to that microcontroller
    contexts: Record<string, ContextEntry[]>;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export class ComponentState {
    private registry: AMComponentDefinition[] = [];
    private contexts = new Map<string, ContextEntry[]>();
    private hasWorkspace = false;
    private contextsReceived = false;

    setRegistry(registry: AMComponentDefinition[]) {
        this.registry = registry;
    }

    setContexts(message: ContextsMessage) {
        this.hasWorkspace = message.hasWorkspace;
        this.contexts = new Map(Object.entries(message.contexts));
        this.contextsReceived = true;
    }

    // Without a workspace contexts can't be saved, so context-based checks would only be noise.
    get active(): boolean {
        return this.contextsReceived && this.hasWorkspace;
    }

    findInRegistry(name: string): AMComponentDefinition | undefined {
        const n = norm(name);
        return this.registry.find(c => norm(c.displayName) === n || norm(c.name) === n);
    }

    contextFor(uri: string): ContextEntry[] {
        return this.contexts.get(uri) ?? [];
    }
}

interface PathUse {
    path: GSPathExpression;
    isWrite: boolean;
}

// Generic walk so paths are found wherever they appear in the tree.
function collectPaths(root: unknown): PathUse[] {
    const found: PathUse[] = [];
    const writeTargets = new Set<unknown>();

    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') {
            return;
        }
        const n = node as Record<string, unknown>;
        if (n.kind === 'AssignmentStatement') {
            writeTargets.add(n.target);
        }
        if (n.kind === 'PathExpression') {
            found.push({ path: n as unknown as GSPathExpression, isWrite: writeTargets.has(node) });
        }
        for (const value of Object.values(n)) {
            if (value && typeof value === 'object') {
                visit(value);
            }
        }
    };
    visit(root);
    return found;
}

export function checkComponents(program: GSProgram, document: TextDocument, state: ComponentState): Diagnostic[] {
    if (!state.active) {
        return [];
    }

    const diagnostics: Diagnostic[] = [];
    const context = state.contextFor(document.uri);
    const range = (start: number, end: number) => ({
        start: document.positionAt(start),
        end: document.positionAt(end)
    });

    for (const { path, isWrite } of collectPaths(program)) {
        if (path.targetStart === undefined || path.targetEnd === undefined || !path.target) {
            continue;
        }

        const entry = context.find(e => {
            if (e.alias) {
                return norm(e.alias) === norm(path.target);
            }
            const def = state.findInRegistry(e.id);
            return norm(def?.displayName ?? e.id) === norm(path.target);
        });

        if (!entry) {
            // An aliased name can't be resolved to a type, so only offer a fix for registry names.
            const def = state.findInRegistry(path.target);
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: range(path.targetStart, path.targetEnd),
                message: `Component "${path.target}" is not in this microcontroller's context`,
                source: 'Anymaker',
                code: NOT_IN_CONTEXT_CODE,
                data: def ? { componentId: def.name, uri: document.uri } : undefined
            });
            continue;
        }

        const def = state.findInRegistry(entry.id);
        if (!def || path.pinStart === undefined || path.pinEnd === undefined || !path.pin) {
            continue;
        }

        const label = entry.alias ? `${entry.alias} (${def.displayName})` : def.displayName;
        const pins = def.pins.filter(p => norm(p.name) === norm(path.pin));
        const pinRange = range(path.pinStart, path.pinEnd);

        if (pins.length === 0) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: pinRange,
                message: `Component "${label}" has no value named "${path.pin}"`,
                source: 'Anymaker'
            });
        } else if (isWrite && !pins.some(p => p.direction === 'input')) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: pinRange,
                message: `Cannot write to "${path.pin}": it is a read-only output`,
                source: 'Anymaker'
            });
        } else if (!isWrite && !pins.some(p => p.direction === 'output')) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: pinRange,
                message: `Cannot read "${path.pin}": it is a write-only input`,
                source: 'Anymaker'
            });
        }
    }

    return diagnostics;
}
