import { workspace, ConfigurationTarget, window } from 'vscode';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { ClarionExtensionCommands } from './ClarionExtensionCommands';
import LoggerManager from './logger';
import * as path from 'path';
const logger = LoggerManager.getLogger("Globals");

// Interface for solution settings
export interface ClarionSolutionSettings {
    solutionFile: string;
    propertiesFile: string;
    version: string;
    configuration: string;
}

// ✅ These are stored in workspace settings
export let globalSolutionFile: string = "";
export let globalClarionPropertiesFile: string = "";
export let globalClarionVersion: string = "";
let _globalClarionConfiguration: string = "Release";

// ✅ Ensure these settings are available globally
const DEFAULT_EXTENSIONS = [".clw", ".inc", ".equ", ".eq", ".int"];

export async function setGlobalClarionSelection(
    solutionFile: string,
    clarionPropertiesFile: string,
    clarionVersion: string,
    clarionConfiguration: string
) {
    logger.info("🔄 Updating global settings:", {
        solutionFile,
        clarionPropertiesFile,
        clarionVersion,
        clarionConfiguration
    });

    // ✅ Update global variables
    globalSolutionFile = solutionFile;
    globalClarionPropertiesFile = clarionPropertiesFile;
    globalClarionVersion = clarionVersion;
    _globalClarionConfiguration = clarionConfiguration;

    // Log the updated global variables
    logger.info(`✅ Global variables updated:
        - globalSolutionFile: ${globalSolutionFile || 'not set'}
        - globalClarionPropertiesFile: ${globalClarionPropertiesFile || 'not set'}
        - globalClarionVersion: ${globalClarionVersion || 'not set'}
        - _globalClarionConfiguration: ${_globalClarionConfiguration || 'not set'}`);

    // ✅ Only save to workspace if all required values are set
    if (solutionFile && clarionPropertiesFile && clarionVersion) {
        logger.info("✅ All required settings are set. Saving to workspace settings...");
        
        // Update the current solution settings
        await workspace.getConfiguration().update('clarion.solutionFile', solutionFile, ConfigurationTarget.Workspace);
        await workspace.getConfiguration().update('clarion.propertiesFile', clarionPropertiesFile, ConfigurationTarget.Workspace);
        await workspace.getConfiguration().update('clarion.version', clarionVersion, ConfigurationTarget.Workspace);
        await workspace.getConfiguration().update('clarion.configuration', clarionConfiguration, ConfigurationTarget.Workspace);
        
        // Update the current solution in the solutions array
        await updateSolutionsArray(solutionFile, clarionPropertiesFile, clarionVersion, clarionConfiguration);
        
        // Set the current solution
        await workspace.getConfiguration().update('clarion.currentSolution', solutionFile, ConfigurationTarget.Workspace);

        // ✅ Ensure lookup extensions are written ONLY when a valid solution exists
        const config = workspace.getConfiguration("clarion");

        const fileSearchExtensions = config.inspect<string[]>("fileSearchExtensions")?.workspaceValue;
        const defaultLookupExtensions = config.inspect<string[]>("defaultLookupExtensions")?.workspaceValue;

        const updatePromises: Thenable<void>[] = [];

        if (!fileSearchExtensions) {
            updatePromises.push(config.update("fileSearchExtensions", DEFAULT_EXTENSIONS, ConfigurationTarget.Workspace));
        }

        if (!defaultLookupExtensions) {
            updatePromises.push(config.update("defaultLookupExtensions", DEFAULT_EXTENSIONS, ConfigurationTarget.Workspace));
        }

        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
            logger.info("✅ Default lookup settings applied to workspace.json.");
        }
    } else {
        logger.warn("⚠️ Not saving to workspace settings: One or more required values are missing.");
    }
}

/**
 * Updates the solutions array in workspace settings
 */
async function updateSolutionsArray(
    solutionFile: string,
    clarionPropertiesFile: string,
    clarionVersion: string,
    clarionConfiguration: string
) {
    if (!solutionFile) return;
    
    // Get the current solutions array
    const config = workspace.getConfiguration("clarion");
    const solutions = config.get<ClarionSolutionSettings[]>("solutions", []);
    
    // Check if this solution is already in the array
    const solutionIndex = solutions.findIndex(s => s.solutionFile === solutionFile);
    
    if (solutionIndex >= 0) {
        // Update existing solution
        solutions[solutionIndex] = {
            solutionFile,
            propertiesFile: clarionPropertiesFile,
            version: clarionVersion,
            configuration: clarionConfiguration
        };
    } else {
        // Add new solution
        solutions.push({
            solutionFile,
            propertiesFile: clarionPropertiesFile,
            version: clarionVersion,
            configuration: clarionConfiguration
        });
    }
    
    // Save the updated solutions array
    await config.update("solutions", solutions, ConfigurationTarget.Workspace);
    logger.info(`✅ Updated solutions array with ${solutions.length} solutions`);
}


// ❌ These should NOT be saved in workspace
let _globalRedirectionFile = "";
let _globalRedirectionPath = "";
let _globalMacros: Record<string, string> = {};
let _globalLibsrcPaths: string[] = [];

// ✅ Use `get` and `set` properties instead of exports
export const globalSettings = {
    get defaultLookupExtensions() {
        return workspace.getConfiguration("clarion").get<string[]>("defaultLookupExtensions", DEFAULT_EXTENSIONS);
    },

    get fileSearchExtensions() {
        return workspace.getConfiguration("clarion").get<string[]>("fileSearchExtensions", DEFAULT_EXTENSIONS);
    },

    get configuration() {
        return _globalClarionConfiguration;
    },
    set configuration(value: string) {
        _globalClarionConfiguration = value;
    },

    get redirectionFile() {
        return _globalRedirectionFile;
    },
    set redirectionFile(value: string) {
        _globalRedirectionFile = value;
    },

    get redirectionPath() {
        return _globalRedirectionPath;
    },
    set redirectionPath(value: string) {
        _globalRedirectionPath = value;
    },

    get macros() {
        return _globalMacros;
    },
    set macros(value: Record<string, string>) {
        _globalMacros = value;
    },

    get libsrcPaths() {
        return _globalLibsrcPaths;
    },
    set libsrcPaths(value: string[]) {
        _globalLibsrcPaths = value;
    },

    /** ✅ Ensure default settings are initialized in workspace.json */
    async initialize() {
        const config = workspace.getConfiguration("clarion");

        // Check if settings already exist in workspace.json
        const fileSearchExtensions = config.inspect<string[]>("fileSearchExtensions")?.workspaceValue;
        const defaultLookupExtensions = config.inspect<string[]>("defaultLookupExtensions")?.workspaceValue;

        const updatePromises: Thenable<void>[] = [];

        // if (!fileSearchExtensions) {
        //     updatePromises.push(config.update("fileSearchExtensions", DEFAULT_EXTENSIONS, ConfigurationTarget.Workspace));
        // }

        // if (!defaultLookupExtensions) {
        //     updatePromises.push(config.update("defaultLookupExtensions", DEFAULT_EXTENSIONS, ConfigurationTarget.Workspace));
        // }

        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
            window.showInformationMessage("Clarion extension: Default settings applied to workspace.json.");
        }
    },

    /**
     * Migrates existing settings to the solutions array
     */
    async migrateToSolutionsArray() {
        logger.info("🔄 Checking if migration to solutions array is needed...");
        
        const config = workspace.getConfiguration("clarion");
        
        // Check if we already have a solutions array
        const solutions = config.get<ClarionSolutionSettings[]>("solutions", []);
        
        // Check if we have a current solution setting
        const currentSolution = config.get<string>("currentSolution", "");
        
        // Get the existing settings
        const solutionFile = config.get<string>("solutionFile", "");
        const propertiesFile = config.get<string>("propertiesFile", "");
        const version = config.get<string>("version", "");
        const configuration = config.get<string>("configuration", "Release");
        
        // If we have a solution file but no solutions array or current solution, migrate
        if (solutionFile && (!solutions.length || !currentSolution)) {
            logger.info("✅ Migration needed. Creating solutions array from existing settings.");
            
            // Create a new solution entry
            const newSolution: ClarionSolutionSettings = {
                solutionFile,
                propertiesFile,
                version,
                configuration
            };
            
            // Add to solutions array if not already there
            if (!solutions.some(s => s.solutionFile === solutionFile)) {
                solutions.push(newSolution);
                await config.update("solutions", solutions, ConfigurationTarget.Workspace);
                logger.info(`✅ Added solution to solutions array: ${solutionFile}`);
            }
            
            // Set current solution if not already set
            if (!currentSolution) {
                await config.update("currentSolution", solutionFile, ConfigurationTarget.Workspace);
                logger.info(`✅ Set current solution to: ${solutionFile}`);
            }
            
            logger.info("✅ Migration to solutions array completed successfully.");
        } else {
            logger.info("✅ No migration needed or already migrated.");
        }
    },
    
    /** ✅ Load settings from workspace.json */
    async initializeFromWorkspace() {
        logger.info("🔄 Loading settings from workspace.json...");

        // Check if we need to migrate existing settings to the solutions array
        await this.migrateToSolutionsArray();

        // Get the current solution from settings
        const currentSolution = workspace.getConfiguration().get<string>("clarion.currentSolution", "");
        
        // ✅ Read workspace settings
        let solutionFile = workspace.getConfiguration().get<string>("clarion.solutionFile", "") || "";
        let clarionPropertiesFile = workspace.getConfiguration().get<string>("clarion.propertiesFile", "") || "";
        let clarionVersion = workspace.getConfiguration().get<string>("clarion.version", "") || "";
        let clarionConfiguration = workspace.getConfiguration().get<string>("clarion.configuration", "") || "Release";

        // If we have a current solution, try to find it in the solutions array
        if (currentSolution) {
            const solutions = workspace.getConfiguration().get<ClarionSolutionSettings[]>("clarion.solutions", []);
            const solution = solutions.find(s => s.solutionFile === currentSolution);
            
            if (solution) {
                logger.info(`✅ Found current solution in solutions array: ${solution.solutionFile}`);
                solutionFile = solution.solutionFile;
                clarionPropertiesFile = solution.propertiesFile;
                clarionVersion = solution.version;
                clarionConfiguration = solution.configuration;
            } else {
                logger.warn(`⚠️ Current solution ${currentSolution} not found in solutions array`);
            }
        }

        logger.info(`🔍 Read from workspace settings:
            - clarion.solutionFile: ${solutionFile || 'not set'}
            - clarion.propertiesFile: ${clarionPropertiesFile || 'not set'}
            - clarion.version: ${clarionVersion || 'not set'}
            - clarion.configuration: ${clarionConfiguration || 'not set'}`);

        // ✅ Set global variables
        await setGlobalClarionSelection(solutionFile, clarionPropertiesFile, clarionVersion, clarionConfiguration);

        // ✅ Ensure ClarionProperties.xml exists before parsing
        if (!clarionPropertiesFile || !fs.existsSync(clarionPropertiesFile)) {
            logger.warn("⚠️ ClarionProperties.xml not found. Skipping extraction of additional settings.");
            return;
        }

        try {
            // ✅ Parse ClarionProperties.xml
            const xmlContent = fs.readFileSync(clarionPropertiesFile, "utf-8");
            const parsedXml = await parseStringPromise(xmlContent);

            const versions = parsedXml.ClarionProperties?.Properties?.find(
                (p: any) => p.$.name === "Clarion.Versions"
            );
            const selectedVersion = versions?.Properties?.find(
                (p: any) => p.$.name === clarionVersion
            );

            if (!selectedVersion) {
                logger.warn(`⚠️ Clarion version '${clarionVersion}' not found in ClarionProperties.xml.`);
                return;
            }

            // ✅ Extract additional settings
            globalSettings.redirectionFile =
                selectedVersion.Properties?.find((p: any) => p.$.name === "RedirectionFile")?.Name?.[0]?.$.value || "";

            globalSettings.redirectionPath =
                selectedVersion.Properties?.find((p: any) => p.$.name === "RedirectionFile")?.Properties?.find(
                    (p: any) => p.$.name === "Macros"
                )?.reddir?.[0]?.$.value || "";

            globalSettings.macros = ClarionExtensionCommands.extractMacros(selectedVersion.Properties);
            globalSettings.libsrcPaths =
                selectedVersion.libsrc?.[0]?.$.value.split(";") || [];

             logger.info("✅ Extracted Clarion settings from ClarionProperties.xml", {
                redirectionFile: globalSettings.redirectionFile,
                redirectionPath: globalSettings.redirectionPath,
                macros: globalSettings.macros,
                libsrcPaths: globalSettings.libsrcPaths
            });

        } catch (error) {
            logger.error("❌ Error parsing ClarionProperties.xml:", error);
        }
    }
};
