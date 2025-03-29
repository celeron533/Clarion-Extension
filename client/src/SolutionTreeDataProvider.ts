import { TreeDataProvider, TreeItem, Event, EventEmitter, TreeItemCollapsibleState, ThemeIcon } from 'vscode';
import { TreeNode } from './TreeNode';
import { ClarionSolutionInfo, ClarionProjectInfo, ClarionSourcerFileInfo } from 'common/types';
import LoggerManager from './logger';
import * as path from 'path';
import { SolutionCache } from './SolutionCache';

const logger = LoggerManager.getLogger("SolutionTreeDataProvider");
logger.setLevel("info");

export class SolutionTreeDataProvider implements TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: EventEmitter<void> = new EventEmitter<void>();
    readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event;

    private _root: TreeNode[] | null = null;
    private solutionCache: SolutionCache;

    constructor() {
        this.solutionCache = SolutionCache.getInstance();
    }

    async refresh(): Promise<void> {
        logger.info("🔄 Refreshing solution tree...");
        
        try {
            // Refresh the solution cache first
            await this.solutionCache.refresh();
            
            // Then get the tree items
            await this.getTreeItems();
            
            if (!this._root) {
                logger.warn("⚠️ Tree root is still null after refresh attempt.");
            } else {
                logger.info(`✅ Tree refreshed successfully with ${this._root.length} root item(s).`);
            }
            
            // Notify VS Code that the tree data has changed
            this._onDidChangeTreeData.fire();
        } catch (error) {
            logger.error(`❌ Error refreshing solution tree: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (element && element.children) {
            return element.children;
        }
        
        if (!this._root) {
            // If root is not initialized, fetch it
            return this.getTreeItems();
        }
        
        return this._root;
    }

    getTreeItem(element: TreeNode): TreeItem {
        const label = element.label || "Unnamed Item";
        const treeItem = new TreeItem(label, element.collapsibleState);

        const data = element.data;

        if ((data as any)?.guid) {
            const project = data as ClarionProjectInfo;
            treeItem.iconPath = new ThemeIcon('project');
            treeItem.contextValue = 'clarionProject';
            const projectFile = path.join(project.path, `${project.name}.cwproj`);
            treeItem.command = {
                title: 'Open Project File',
                command: 'clarion.openFile',
                arguments: [projectFile]
            };
            logger.info(`📂 getTreeItem(): Project – ${project.name}`);
        } else if ((data as any)?.relativePath) {
            const file = data as ClarionSourcerFileInfo;
            treeItem.iconPath = new ThemeIcon('file-code');
            treeItem.command = {
                title: 'Open File',
                command: 'clarion.openFile',
                arguments: [file.relativePath]
            };
            logger.info(`📄 getTreeItem(): File – ${file.name} (${file.relativePath})`);
        } else {
            const solution = data as ClarionSolutionInfo;
            treeItem.iconPath = new ThemeIcon('file-symlink-directory');
            treeItem.contextValue = 'clarionSolution';
            treeItem.command = {
                title: 'Open Solution File',
                command: 'clarion.openFile',
                arguments: [solution.path]
            };
            logger.info(`🧩 getTreeItem(): Solution – ${solution.name}`);
        }

        return treeItem;
    }

    async getTreeItems(): Promise<TreeNode[]> {
        try {
            logger.info("🔄 Getting solution tree from cache...");
            
            // Try to refresh the solution cache first
            try {
                await this.solutionCache.refresh();
                logger.info("✅ Solution cache refreshed successfully");
            } catch (refreshError) {
                logger.error(`❌ Error refreshing solution cache: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
                // Continue with potentially stale data
            }
            
            const solution = this.solutionCache.getSolutionInfo();
            
            if (!solution) {
                logger.warn("⚠️ No solution available in cache.");
                return this._root || [];
            }

            if (!solution.projects) {
                logger.warn("⚠️ Solution has undefined projects array");
                return this._root || [];
            }
            
            if (!Array.isArray(solution.projects)) {
                logger.warn(`⚠️ Solution projects is not an array: ${typeof solution.projects}`);
                return this._root || [];
            }
            
            if (solution.projects.length === 0) {
                logger.warn("⚠️ Solution has empty projects array");
                return this._root || [];
            }

            logger.info(`🌲 Building tree for solution: ${solution.name}`);
            logger.info(`📁 Projects in solution: ${solution.projects.length}`);
            solution.projects.forEach(p => {
                if (!p) {
                    logger.warn("⚠️ Found null or undefined project in solution");
                    return;
                }
                logger.info(` ├─ ${p.name || 'unnamed'} (${p.sourceFiles?.length || 0} files)`);
            });

            const solutionNode = new TreeNode(
                solution.name || "Solution",
                TreeItemCollapsibleState.Expanded,
                solution
            );

            // Filter out any null or undefined projects
            const validProjects = solution.projects.filter(p => p !== null && p !== undefined);
            
            for (const project of validProjects) {
                const projectNode = new TreeNode(
                    project.name || "Unnamed Project",
                    TreeItemCollapsibleState.Expanded,
                    project,
                    solutionNode
                );

                if (project.sourceFiles && Array.isArray(project.sourceFiles)) {
                    // Filter out any null or undefined source files
                    const validSourceFiles = project.sourceFiles.filter(sf => sf !== null && sf !== undefined);
                    
                    for (const sourceFile of validSourceFiles) {
                        const sourceFileNode = new TreeNode(
                            sourceFile.name || "Unnamed File",
                            TreeItemCollapsibleState.None,
                            sourceFile,
                            projectNode
                        );
                        logger.info(`     📄 ${sourceFile.name || 'unnamed'} — ${sourceFile.relativePath || 'no path'}`);
                        projectNode.children.push(sourceFileNode);
                    }
                    
                    logger.info(`     ✅ Added ${validSourceFiles.length} source files to project ${project.name || 'unnamed'}`);
                } else {
                    logger.warn(`⚠️ Project ${project.name || 'unnamed'} has no valid sourceFiles array`);
                }

                solutionNode.children.push(projectNode);
            }

            this._root = [solutionNode];
            this._onDidChangeTreeData.fire();
            logger.info("✅ Solution tree updated successfully");
            
            return this._root;
        } catch (error) {
            logger.error(`❌ Error building solution tree: ${error instanceof Error ? error.message : String(error)}`);
            return this._root || [];
        }
    }
}
