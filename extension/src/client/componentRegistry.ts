import fs from 'fs';
import path from 'path';

export interface AMMicrocontrollerPin {
    name: string;
    type: "f64" | "s32" | "bool";
    direction: "input" | "output";
}

export interface AMComponentDefinition {
    name: string;
    displayName: string;
    alias?: string;
    pins: AMMicrocontrollerPin[];
}

export class AMComponentRegistry {
    private static components: AMComponentDefinition[] = [];

    private internalComponentPaths: string[] = [
        "/rom/data/vehicle_component_definitions.json"
    ];

    private processPath(path: string) {
        const json = JSON.parse(fs.readFileSync(path, 'utf-8'));
        for (const def of json.definitions as any[]) {
            const mc_interfaces = def.data_descriptors;
            if (!mc_interfaces || mc_interfaces.length === 0) {
                continue;
            }

            let component: AMComponentDefinition = {
                name: def.id,
                displayName: def.name,
                pins: []
            };

            for (const mc_interface of mc_interfaces as any[]) {
                // mc_interface.type = "type_f64_output" as example
                // where direction is "output" or "input"
                // and type is "f64" or "s32"

                if (!mc_interface.type) {
                    continue;
                }

                let direction = mc_interface.type as string;
                direction = direction.substring(direction.lastIndexOf("_") + 1, direction.length);

                let type = mc_interface.type as string;
                type = type.substring(0, type.lastIndexOf("_"));
                type = type.substring(type.lastIndexOf("_") + 1, type.length);
                
                let pin: AMMicrocontrollerPin = {
                    name: mc_interface.name,
                    type: type as "f64" | "s32" | "bool",
                    direction: direction as "input" | "output"
                };
                component.pins.push(pin);
            }
            AMComponentRegistry.components.push(component);
        }
    }

    public registerComponents(directory: string | undefined): number {
        if (!directory || !fs.existsSync(directory)) {
            return 0;
        }

        let paths: string[] = [];

        for (const internalPath of this.internalComponentPaths) {
            const fullPath = path.join(directory, internalPath);
            if (fs.existsSync(fullPath)) {
                paths.push(fullPath);
            }
        }

        for (const p of paths) {
            this.processPath(p);
        }
        console.log(`Registered components: ${AMComponentRegistry.components.length}`);
        return AMComponentRegistry.components.length;
    }

    public static getAllComponents(): AMComponentDefinition[] {
        return AMComponentRegistry.components;
    }
}