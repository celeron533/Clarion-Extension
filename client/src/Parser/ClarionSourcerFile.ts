// import * as path from 'path';
// import * as fs from 'fs';
// import { Uri } from 'vscode';
// import { ClarionProject } from './ClarionProject';
// import { ClarionSourcerFileInfo } from 'common/types';



// export class ClarionSourcerFile {
//     private fileContent: string | null = null;

//     constructor(
//         public name: string,
//         public relativePath: string,
//         public project?: ClarionProject
//     ) {}

//     // ✅ Add this factory method
//     public static fromInfo(info: ClarionSourcerFileInfo, projectMap: Map<string, ClarionProject>): ClarionSourcerFile {
//         const matchingProject = info.project ? projectMap.get(info.project.guid) : undefined;
//         return new ClarionSourcerFile(info.name, info.relativePath, matchingProject);
//     }

//     public toInfo(): ClarionSourcerFileInfo {
//         return {
//             name: this.name,
//             relativePath: this.relativePath,
//             project: this.project
//                 ? {
//                       name: this.project.name,
//                       type: this.project.type,
//                       path: this.project.path,
//                       guid: this.project.guid
//                   }
//                 : undefined
//         };
//     }

//     getAbsolutePath(): string | null {
//         if (!this.project) return null;

//         const projectPath = this.project.path;
//         const fileExt = path.extname(this.name).toLowerCase();

//         const projectFilePath = path.join(projectPath, this.relativePath);
//         if (fs.existsSync(projectFilePath)) {
//             return projectFilePath;
//         }

//         const searchPaths = this.project.getSearchPaths(fileExt);
//         for (const searchPath of searchPaths) {
//             const possibleFilePath = path.join(searchPath, this.name);
//             if (fs.existsSync(possibleFilePath)) {
//                 return possibleFilePath;
//             }
//         }

//         return null;
//     }

//     getUri(): Uri | null {
//         const absolutePath = this.getAbsolutePath();
//         return absolutePath ? Uri.file(absolutePath) : null;
//     }

//     exists(): boolean {
//         return this.getAbsolutePath() !== null;
//     }

//     getContent(): string | null {
//         if (this.fileContent !== null) {
//             return this.fileContent;
//         }

//         const absolutePath = this.getAbsolutePath();
//         if (!absolutePath) return null;

//         try {
//             this.fileContent = fs.readFileSync(absolutePath, 'utf-8');
//             return this.fileContent;
//         } catch (error) {
//             console.error(`Error reading file ${absolutePath}:`, error);
//             return null;
//         }
//     }

//     invalidateCache(): void {
//         this.fileContent = null;
//     }

//     findPatternMatches(pattern: RegExp): RegExpExecArray[] {
//         const content = this.getContent();
//         if (!content) return [];

//         const matches: RegExpExecArray[] = [];
//         let match: RegExpExecArray | null;

//         pattern.lastIndex = 0;

//         while ((match = pattern.exec(content)) !== null) {
//             matches.push(match);
//         }

//         return matches;
//     }
// }
