import { workspace, window, tasks, Task, ShellExecution, TaskScope, TaskProcessEndEvent, TaskRevealKind, TaskPanelKind, TextEditor, Diagnostic, DiagnosticSeverity, Range, languages, Uri } from "vscode";
import { globalSolutionFile, globalSettings } from "./globals";
import * as path from "path";
import * as fs from "fs";
import processBuildErrors from "./processBuildErrors";
import { SolutionParser } from "./Parser/SolutionParser";
import LoggerManager from './logger';
import { ClarionProject } from "./Parser/ClarionProject";
const logger = LoggerManager.getLogger("BuildTasks");
logger.setLevel("error");
/**
 * Main entry point for the Clarion build process
 */
export async function runClarionBuild() {
    if (!validateBuildEnvironment()) {
        return;
    }

    // Load the solution parser
    const solutionParser = await loadSolutionParser();
    if (!solutionParser) {
        return;
    }

    // Determine what to build
    const buildConfig = await determineBuildTarget(solutionParser);
    if (!buildConfig) {
        window.showInformationMessage("⏹ Build cancelled.");
        return;
    }

    // Prepare build task parameters
    const buildParams = prepareBuildParameters(buildConfig);

    // Execute the build task
    await executeBuildTask(buildParams);
}

/**
 * Validates the build environment
 */
export function validateBuildEnvironment(): boolean {
    if (!workspace.isTrusted) {
        window.showWarningMessage("Clarion features require a trusted workspace.");
        return false;
    }

    if (!globalSolutionFile || !globalSettings.redirectionPath) {
        window.showErrorMessage("❌ Cannot build: Missing solution file or Clarion redirection path.");
        return false;
    }

    return true;
}

/**
 * Loads the solution parser
 */
export async function loadSolutionParser(): Promise<SolutionParser | null> {
    try {
        const solutionParser = await SolutionParser.create(globalSolutionFile);

        if (solutionParser.solution.projects.length === 0) {
            window.showErrorMessage("❌ No projects found in the solution.");
            return null;
        }

        return solutionParser;
    } catch (error) {
        window.showErrorMessage(`❌ Failed to parse solution file: ${error}`);
        return null;
    }
}

/**
 * Determines what to build (full solution or specific project)
 */
async function determineBuildTarget(solutionParser: SolutionParser): Promise<{
    buildTarget: "Solution" | "Project";
    selectedProjectPath: string;
} | null> {
    let buildTarget: "Solution" | "Project" = "Solution";
    let selectedProjectPath = "";

    if (solutionParser.solution.projects.length <= 1) {
        // Only one project, use solution build
        return { buildTarget, selectedProjectPath };
    }

    // Try to find the project for the active file
    const currentProject = findCurrentProject(solutionParser);
    if (currentProject) {
        selectedProjectPath = currentProject.path;
    }

    const buildOptions = ["Build Full Solution"];

    if (currentProject) {
        buildOptions.push(`Build Current Project: ${currentProject.name}`);
    }

    buildOptions.push("Cancel");

    // Ask user what to build
    const selectedOption = await window.showQuickPick(buildOptions, {
        placeHolder: "Select a build target",
    });

    if (!selectedOption || selectedOption === "Cancel") {
        return null;
    }

    if (selectedOption.startsWith("Build Current Project")) {
        buildTarget = "Project";
    }

    return { buildTarget, selectedProjectPath };
}

/**
 * Finds the project that contains the file in the active editor
 */
function findCurrentProject(solutionParser: SolutionParser) {
    const activeEditor: TextEditor | undefined = window.activeTextEditor;

    if (!activeEditor) {
        return undefined;
    }

    const activeFilePath = activeEditor.document.uri.fsPath;
    const activeFileName = path.basename(activeFilePath);

    return solutionParser.findProjectForFile(activeFileName);
}

/**
 * Prepares build parameters
 */
export function prepareBuildParameters(buildConfig: {
    buildTarget: "Solution" | "Project";
    selectedProjectPath: string;
    projectObject?: ClarionProject; // Add this parameter
}): {
    solutionDir: string;
    msBuildPath: string;
    buildArgs: string[];
    buildLogPath: string;
    buildTarget: "Solution" | "Project";
    targetName: string;
} {
    const solutionDir = path.dirname(globalSolutionFile);
    const clarionBinPath = globalSettings.redirectionPath.replace(/redirection.*/i, "bin");
    const msBuildPath = "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\msbuild.exe";
    const buildLogPath = path.join(solutionDir, "build_output.log");

    // Extract target name correctly
    let targetName = "";
    if (buildConfig.buildTarget === "Solution") {
        targetName = path.basename(globalSolutionFile);
    } else {
        // Use the project object's name if available, otherwise extract from path
        targetName = buildConfig.projectObject ? 
            buildConfig.projectObject.name : 
            path.basename(path.dirname(buildConfig.selectedProjectPath)); // Use directory name
    }

    const selectedConfig = globalSettings.configuration || "Debug"; // Ensure a fallback

    const buildArgs = [
        "/property:GenerateFullPaths=true",
        "/t:build",
        "/m",
        "/consoleloggerparameters:ErrorsOnly",
        `/property:Configuration=${selectedConfig}`,
        `/property:clarion_Sections=${selectedConfig}`,
        `/property:ClarionBinPath="${clarionBinPath}"`,
        "/property:NoDependency=true",
        "/property:Verbosity=detailed",
        "/property:WarningLevel=5"
    ];


    if (buildConfig.buildTarget === "Solution") {
        buildArgs.push(`/property:SolutionDir="${globalSolutionFile}"`);
    } else if (buildConfig.buildTarget === "Project") {
        buildArgs.push(`/property:ProjectPath="${buildConfig.selectedProjectPath}"`);
    }

    return { 
        solutionDir, 
        msBuildPath, 
        buildArgs, 
        buildLogPath,
        buildTarget: buildConfig.buildTarget,
        targetName
    };
}

/**
 * Executes the build task and processes results
 */
export async function executeBuildTask(params: {
    solutionDir: string;
    msBuildPath: string;
    buildArgs: string[];
    buildLogPath: string;
    buildTarget: "Solution" | "Project";
    targetName: string;
}): Promise<void> {
    const { solutionDir, msBuildPath, buildArgs, buildLogPath, buildTarget, targetName } = params;

    // Create the shell execution - restore log file redirection
    const execution = new ShellExecution(
        `${msBuildPath} ${buildArgs.join(" ")} > "${buildLogPath}" 2>&1`,
        { cwd: solutionDir }
    );

    // Create the task
    const task = createBuildTask(execution);

    try {
        // Show a more specific message based on what's being built
        const buildTypeMessage = buildTarget === "Solution" 
            ? `🔄 Building Clarion Solution: ${targetName}` 
            : `🔄 Building Clarion Project: ${targetName}.cwproj`;
        
        window.showInformationMessage(buildTypeMessage);

        // Pass the target info to the completion handler
        const disposable = setupBuildCompletionHandler(buildLogPath, buildTarget, targetName);

        await tasks.executeTask(task);
    } catch (error) {
        window.showErrorMessage("❌ Failed to start Clarion build task.");
        logger.error("❌ Clarion Build Task Error:", error);
    }
}

/**
 * Creates the build task
 */
function createBuildTask(execution: ShellExecution): Task {
    const task = new Task(
        { type: "shell" },
        TaskScope.Workspace,
        "Clarion Build",
        "msbuild",
        execution,
        "clarionBuildMatcher"
    );

    // ✅ Set the actual command explicitly
    task.definition = {
        type: "shell",
        command: execution.commandLine
    };

    // Hide terminal output again
    task.presentationOptions = {
        reveal: TaskRevealKind.Never,
        echo: false,
        focus: false,
        panel: TaskPanelKind.Dedicated
    };

    return task;
}

/**
 * Sets up the handler for build completion
 */
function setupBuildCompletionHandler(buildLogPath: string, buildTarget: "Solution" | "Project", targetName: string) {
    return tasks.onDidEndTaskProcess((event: TaskProcessEndEvent) => {
        if (event.execution.task.name === "Clarion Build") {
            processTaskCompletion(event, buildLogPath, buildTarget, targetName);
        }
    });
}

/**
 * Processes the task completion, reads log file, and shows results
 */
function processTaskCompletion(event: TaskProcessEndEvent, buildLogPath: string, buildTarget: "Solution" | "Project", targetName: string) {
    fs.readFile(buildLogPath, "utf8", (err, data) => {
        if (err) {
            logger.info("Error reading build log:", err);
        } else {
            logger.info("Captured Build Output");
            logger.info(data);
            
            // Process the build errors
            processBuildErrors(data);
            
            // If build failed, also check for MSBuild errors
            if (event.exitCode !== 0) {
                processGeneralMSBuildErrors(data);
            }
        }

        // Delete the temporary log file after processing
        fs.unlink(buildLogPath, (unlinkErr) => {
            if (unlinkErr) {
                logger.info("Failed to delete build log:", unlinkErr);
            } else {
                logger.info("Deleted temporary build log");
            }
        });
    });

    if (event.exitCode === 0) {
        // Show success message with target details
        const successMessage = buildTarget === "Solution"
            ? `✅ Building Clarion Solution Complete: ${targetName}`
            : `✅ Building Clarion Project Complete: ${targetName}.cwproj`;
            
        window.showInformationMessage(successMessage);
    } else {
        // Show error message with target details
        const errorMessage = buildTarget === "Solution"
            ? `❌ Solution Build Failed: ${targetName}`
            : `❌ Project Build Failed: ${targetName}`;
            
        window.showErrorMessage(`${errorMessage}. Check the Problems Panel!`);
    }
}

/**
 * Process general MSBuild errors that don't match the standard Clarion error format
 */
function processGeneralMSBuildErrors(output: string) {
    const diagnostics: { [key: string]: Diagnostic[] } = {};
    const diagnosticCollection = languages.createDiagnosticCollection("msbuild-errors");
    
    // Clear previous diagnostics
    diagnosticCollection.clear();
    
    // Improved solution file error pattern with more specific matching
    // Look for lines that start with a number (like 0>) followed by a path and error
    const solutionErrorRegex = /\s*(\d+)>([^(]+?\.(sln|cwproj))\((\d+)\):\s+(?:Solution|Project) file error\s+([A-Z0-9]+):\s+(.+)$/gm;
    
    // Match MSBuild errors like: "MSBUILD : error MSB1009: Project file does not exist."
    const msbuildErrorRegex = /^(?:MSBUILD|.+):\s*(error|warning)\s+([A-Z0-9]+):\s+(.+)$/gm;
    
    let match;
    let hasErrors = false;
    
    // First, check for solution file errors
    while ((match = solutionErrorRegex.exec(output)) !== null) {
        hasErrors = true;
        const [_, linePrefix, filePath, fileExt, line, code, message] = match;
        
        // Validate the file path to make sure it's a real path
        if (!filePath || !fs.existsSync(filePath)) {
            logger.warn(`⚠️ Invalid file path detected in error message: ${filePath}`);
            window.showErrorMessage(`${code}: ${message} (in solution file)`);
            continue;
        }
        
        // Create a diagnostic for the solution file error
        const lineNum = parseInt(line) - 1;
        const diagnostic = new Diagnostic(
            new Range(lineNum, 0, lineNum, 100),
            `${fileExt === 'sln' ? 'Solution' : 'Project'} file error ${code}: ${message}`,
            DiagnosticSeverity.Error
        );
        
        if (!diagnostics[filePath]) {
            diagnostics[filePath] = [];
        }
        diagnostics[filePath].push(diagnostic);
        
        logger.info(`📌 File error detected: ${filePath}(${line}): ${code}: ${message}`);
    }
    
    // Then check for general MSBuild errors
    while ((match = msbuildErrorRegex.exec(output)) !== null) {
        hasErrors = true;
        const [_, severity, code, message] = match;
        
        // Since we don't have file/line info, we'll show it as a general error
        window.showErrorMessage(`MSBuild ${severity} ${code}: ${message}`);
        
        // We'll also add to the diagnostics collection with a generic file
        const diagnostic = new Diagnostic(
            new Range(0, 0, 0, 0),
            `MSBuild ${severity} ${code}: ${message}`,
            severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning
        );
        
        const errorFile = globalSolutionFile; // Use the solution file for general MSBuild errors
        if (!diagnostics[errorFile]) {
            diagnostics[errorFile] = [];
        }
        diagnostics[errorFile].push(diagnostic);
    }
    
    // Apply diagnostics to the problems panel
    Object.keys(diagnostics).forEach(file => {
        // Double check that the file exists before setting diagnostics
        if (fs.existsSync(file)) {
            diagnosticCollection.set(Uri.file(file), diagnostics[file]);
        } else {
            // If file doesn't exist, show a general error message
            const errors = diagnostics[file];
            errors.forEach(error => {
                window.showErrorMessage(`Error in non-existent file: ${file} - ${error.message}`);
            });
        }
    });
    
    return hasErrors;
}
