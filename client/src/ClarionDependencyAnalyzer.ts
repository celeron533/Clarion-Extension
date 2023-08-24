import * as fs from 'fs';
import * as path from 'path';

enum DependencyType {
    Include = 'INCLUDE',
    Module = 'MODULE',
}

export class ClarionDependencyAnalyzer {
    private dependencyGraph: Map<string, { type: DependencyType, modulePath: string, lineNumber: number }[]>;

    constructor(private filePath: string) {
        this.dependencyGraph = new Map<string, { type: DependencyType, modulePath: string, lineNumber: number }[]>();
    }

    private parseDependencies(filePath: string) {
        if (!fs.existsSync(filePath)) {
            return;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        const dependencies: { type: DependencyType, modulePath: string, lineNumber: number }[] = [];

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];
            const includeMatch = line.match(/INCLUDE\('([^']+)'\)/i);
            const moduleMatch = line.match(/MODULE\('([^']+)'\)/i);

            if (includeMatch) {
                const includePath = includeMatch[1];
                dependencies.push({ type: DependencyType.Include, modulePath: includePath, lineNumber });
            }

            if (moduleMatch) {
                const modulePath = moduleMatch[1];
                dependencies.push({ type: DependencyType.Module, modulePath, lineNumber });
            }
        }

        this.dependencyGraph.set(filePath, dependencies);

        for (const dep of dependencies) {
            if (dep.type === DependencyType.Include || dep.type === DependencyType.Module) {
                const absoluteDepPath = path.join(path.dirname(filePath), dep.modulePath);
                if (!this.dependencyGraph.has(absoluteDepPath)) {
                    this.parseDependencies(absoluteDepPath);
                }
            }
        }
    }

    public analyze() {
        this.parseDependencies(this.filePath);
        return this.dependencyGraph;
    }
}

