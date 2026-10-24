import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AMComponentDefinition, AMMicrocontrollerPin, AMComponentRegistry } from "./componentRegistry";

export class AMMicrocontrollerContext {
    public fileName: string = '';
    public components: AMComponentDefinition[] = [];

    public addComponent(component: AMComponentDefinition): number {
        // Clone so aliases are per-instance and don't leak into the registry
        this.components.push({ ...component, pins: [...component.pins] });
        return this.components.length - 1;
    }

    public setAlias(index: number, alias: string) {
        if (index >= 0 && index < this.components.length) {
            this.components[index].alias = alias.trim() || undefined;
        }
    }

    public getComponents(): AMComponentDefinition[] {
        return this.components;
    }

    public clearComponents() {
        this.components = [];
    }

    public removeComponent(index: number) {
        if (index >= 0 && index < this.components.length) {
            this.components.splice(index, 1);
        }
    }
}

export class AMLoadedMicrocontrollers {
    public microcontrollers: AMMicrocontrollerContext[] = [];

    public addMicrocontroller(mc: AMMicrocontrollerContext) {
        this.microcontrollers.push(mc);
    }

    public getMicrocontrollers(): AMMicrocontrollerContext[] {
        return this.microcontrollers;
    }

    public clearMicrocontrollers() {
        this.microcontrollers = [];
    }

    public getOrCreate(fileName: string): AMMicrocontrollerContext {
        let mc = this.microcontrollers.find(m => m.fileName === fileName);
        if (!mc) {
            mc = new AMMicrocontrollerContext();
            mc.fileName = fileName;
            this.microcontrollers.push(mc);
        }
        return mc;
    }

    private configPath(): string | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? path.join(folder.uri.fsPath, '.vscode', 'anymaker.json') : undefined;
    }

    private toKey(fileName: string): string {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? path.relative(folder.uri.fsPath, fileName).replace(/\\/g, '/') : fileName;
    }

    private readonly changed = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.changed.event;

    // Loads saved contexts from .vscode/anymaker.json. Does nothing without a workspace.
    public load() {
        this.readFile();
        this.changed.fire();
    }

    private readFile() {
        const file = this.configPath();
        const folder = vscode.workspace.workspaceFolders?.[0];
        this.microcontrollers = [];
        if (!file || !folder || !fs.existsSync(file)) {
            return;
        }
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).microcontrollers ?? {};
            const registry = AMComponentRegistry.getAllComponents();
            for (const [key, entries] of Object.entries(saved)) {
                const mc = new AMMicrocontrollerContext();
                mc.fileName = path.resolve(folder.uri.fsPath, key);
                for (const entry of entries as { id: string; alias?: string }[]) {
                    // Keep unknown ids as placeholders so they aren't lost on the next save
                    const def = registry.find(c => c.name === entry.id)
                        ?? { name: entry.id, displayName: entry.id, pins: [] };
                    mc.components.push({ ...def, pins: [...def.pins], alias: entry.alias });
                }
                this.microcontrollers.push(mc);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to read anymaker.json: ${e}`);
        }
    }

    public save() {
        this.changed.fire();
        const file = this.configPath();
        if (!file) {
            return;
        }
        const data: Record<string, { id: string; alias?: string }[]> = {};
        for (const mc of this.microcontrollers) {
            if (mc.components.length > 0) {
                data[this.toKey(mc.fileName)] = mc.components.map(c => ({ id: c.name, alias: c.alias }));
            }
        }
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ microcontrollers: data }, null, 2));
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save anymaker.json: ${e}`);
        }
    }
}

export function hasWorkspace(): boolean {
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

export const loadedMicrocontrollers = new AMLoadedMicrocontrollers();

export function isSupportedFile(fileName: string): boolean {
    return /\.(txt|geoscript)$/i.test(fileName);
}

function isSupportedDoc(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && doc.uri.scheme === 'file' && isSupportedFile(doc.uri.fsPath);
}

let lastSupportedPath: string | undefined;

// Prefers the active editor; otherwise falls back to a supported file visible in another pane.
function getCurrentDocument(): vscode.TextDocument | undefined {
    const active = vscode.window.activeTextEditor?.document;
    if (isSupportedDoc(active)) {
        lastSupportedPath = active.uri.fsPath;
        return active;
    }
    const visible = vscode.window.visibleTextEditors
        .map(e => e.document)
        .filter(isSupportedDoc);
    return visible.find(d => d.uri.fsPath === lastSupportedPath) ?? visible[0];
}

export function hasSupportedFile(): boolean {
    return getCurrentDocument() !== undefined;
}

// The context of the current Anymaker file, if any.
export function getCurrentContext(): AMMicrocontrollerContext | undefined {
    const doc = getCurrentDocument();
    return doc ? loadedMicrocontrollers.getOrCreate(doc.uri.fsPath) : undefined;
}