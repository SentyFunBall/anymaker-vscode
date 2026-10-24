import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCurrentContext, loadedMicrocontrollers } from './mcContext';
import { contextChanged } from './commandRunner';
import { AMMicrocontrollerPin } from './componentRegistry';

function PinTypeToString(type: string): string {
    switch (type) {
        case 'f64':
            return 'Fractional';
        case 's32':
            return 'Integer';
        default:
            return type;
    }
}

export class ComponentItem extends vscode.TreeItem {
    constructor(public readonly index: number, label: string, realName: string | undefined, pinCount: number) {
        super(label, pinCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.description = realName;
        this.contextValue = 'component';
    }
}

export class PinItem extends vscode.TreeItem {
    constructor(pin: AMMicrocontrollerPin) {
        super(pin.name, vscode.TreeItemCollapsibleState.None);
        this.description = `${PinTypeToString(pin.type)} ${pin.direction}`;
        this.tooltip = `${pin.name}: ${PinTypeToString(pin.type)} (${pin.direction})`;
        this.iconPath = new vscode.ThemeIcon(
            pin.direction === 'input' ? 'arrow-right' : 'arrow-left'
        );
        this.contextValue = 'pin';
    }
}

type TreeNode = ComponentItem | PinItem;

export class ComponentsViewProvider implements vscode.TreeDataProvider<TreeNode> {
    public static readonly viewType = 'anymaker.microcontrollerConfig';

    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    refresh() {
        this.changed.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        const mc = getCurrentContext();
        if (!mc) {
            return [];
        }
        if (element instanceof ComponentItem) {
            return (mc.getComponents()[element.index]?.pins ?? []).map(p => new PinItem(p));
        }
        if (element) {
            return [];
        }
        return mc.getComponents().map((c, i) => {
            const real = c.displayName || c.name;
            return c.alias
                ? new ComponentItem(i, c.alias, real, c.pins.length)
                : new ComponentItem(i, real, undefined, c.pins.length);
        });
    }
}

export function registerComponentsView(context: vscode.ExtensionContext) {
    const provider = new ComponentsViewProvider();
    const view = vscode.window.createTreeView(ComponentsViewProvider.viewType, {
        treeDataProvider: provider
    });

    const updateTitle = () => {
        const mc = getCurrentContext();
        void vscode.commands.executeCommand('setContext', 'anymaker.supportedFileActive', !!mc);
        view.description = mc ? path.basename(mc.fileName) : undefined;
        provider.refresh();
    };
    updateTitle();

    context.subscriptions.push(
        view,
        contextChanged.event(updateTitle),
        vscode.window.onDidChangeActiveTextEditor(updateTitle),
        vscode.window.onDidChangeVisibleTextEditors(updateTitle),
        vscode.commands.registerCommand('anymaker.renameComponent', async (item: ComponentItem) => {
            const mc = getCurrentContext();
            const component = mc?.getComponents()[item?.index];
            if (!mc || !component) {
                return;
            }
            const alias = await vscode.window.showInputBox({
                prompt: `Alias for ${component.displayName || component.name} (empty to clear)`,
                value: component.alias ?? ''
            });
            if (alias !== undefined) {
                mc.setAlias(item.index, alias);
                loadedMicrocontrollers.save();
                provider.refresh();
            }
        }),
        vscode.commands.registerCommand('anymaker.removeComponent', (item: ComponentItem) => {
            const mc = getCurrentContext();
            if (!mc || !mc.getComponents()[item?.index]) {
                return;
            }
            mc.removeComponent(item.index);
            loadedMicrocontrollers.save();
            provider.refresh();
        })
    );
}
