import * as fs from 'fs';
import path = require('path');

export interface clarionProperties {
    directory: string | null;
    fileName: string | null;
    compileMode: string | null;
}

/**
 * Represents a Clarion project that encapsulates logic to locate and parse a Clarion project file (.cwproj) from a given directory.
 *
 * @remarks
 * The class offers methods to recursively search for a project file starting from a given directory and moving up to parent directories.
 * When a project file is located, its content is read and parsed as XML to extract properties such as the compile mode.
 *
 * @property properties - An object containing the parsed Clarion project properties, or null if the project has not been found or parsed.
 *
 * @example
 * Here's how you might use the ClarionProjectClass:
 * ```typescript
 * const project = new ClarionProjectClass();
 * const clarionProperties = project.findProjectOrSolutionDirectory('path/to/start/directory');
 * if (clarionProperties) {
 *   console.log(`Found project file: ${clarionProperties.fileName}`);
 *   console.log(`Compile mode: ${clarionProperties.compileMode}`);
 * }
 * ```
 *
 * @see {@link clarionProperties} for the expected structure of the project properties.
 */
export class ClarionProjectClass {
    public properties: clarionProperties | null = null;
    constructor() {
    }

    private findProjectFile(directory: string): string | null {
        const projectFiles = fs.readdirSync(directory).filter(file => file.endsWith('.cwproj'));
        return projectFiles.length > 0 ? projectFiles[0] : null;
    }

    public  findProjectOrSolutionDirectory(directory: string): clarionProperties | null{
    
        const projectFile = this.findProjectFile(directory);
    
        if (projectFile) {
            const projectFilePath = path.join(directory, projectFile);
            const csprojContent = fs.readFileSync(projectFilePath, 'utf-8');
            const parser = new xml2js.Parser();
            const cleanedContent = csprojContent.replace(/^\uFEFF/, '');
    
            let compileMode = "Unknown";
            parser.parseString(cleanedContent, (err: any, result: any) => {
                if (err) {
                    console.error('Error parsing .csproj file:', err);
                    return;
                }
    
                const configurationValue = result.Project.PropertyGroup[0].Configuration[0]._;
                compileMode = configurationValue || "Unknown";
               
            });
            return {
                directory,
                fileName: projectFile,
                compileMode
            }
    
        } else {
            const parentDirectory = path.dirname(directory);
            if (parentDirectory !== directory) {
                return this.findProjectOrSolutionDirectory(parentDirectory);
            }
        }
        return null;
    }
}
const xml2js = require('xml2js');

