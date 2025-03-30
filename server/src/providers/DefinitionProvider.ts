import { Definition, Location, Position, Range } from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SolutionManager } from '../solution/solutionManager';
import * as path from 'path';
import * as fs from 'fs';
import LoggerManager from '../logger';
import { Token, TokenType } from '../ClarionTokenizer';
import { TokenCache } from '../TokenCache';

const logger = LoggerManager.getLogger("DefinitionProvider");
logger.setLevel("info");

/**
 * Provides goto definition functionality for Clarion files
 */
export class DefinitionProvider {
    private tokenCache = TokenCache.getInstance();
    /**
     * Provides definition locations for a given position in a document
     * @param document The text document
     * @param position The position within the document
     * @returns A Definition (Location or Location[]) or null if no definition is found
     */
    public async provideDefinition(document: TextDocument, position: Position): Promise<Definition | null> {
        logger.info(`Providing definition for position ${position.line}:${position.character} in ${document.uri}`);

        try {
            // Get the word at the current position
            const wordRange = this.getWordRangeAtPosition(document, position);
            if (!wordRange) {
                logger.info('No word found at position');
                return null;
            }

            const word = document.getText(wordRange);
            logger.info(`Found word: "${word}" at position`);

            // Check if this is a structure field reference (either dot notation or prefix notation)
            const structureFieldDefinition = await this.findStructureFieldDefinition(word, document, position);
            if (structureFieldDefinition) {
                logger.info(`Found structure field definition for ${word} in the current document`);
                return structureFieldDefinition;
            }

            // First, check if this is a reference to a label in the current document
            // This is the highest priority - look for labels in the same scope first
            const labelDefinition = await this.findLabelDefinition(word, document, position);
            if (labelDefinition) {
                logger.info(`Found label definition for ${word} in the current document`);
                return labelDefinition;
            }

            // Next, check if this is a reference to a Clarion structure (queue, window, view, etc.)
            const structureDefinition = await this.findStructureDefinition(word, document, position);
            if (structureDefinition) {
                logger.info(`Found structure definition for ${word} in the current document`);
                return structureDefinition;
            }

            // Then, check if this is a reference to a variable or other symbol
            const symbolDefinition = await this.findSymbolDefinition(word, document, position);
            if (symbolDefinition) {
                logger.info(`Found symbol definition for ${word} in the current document`);
                return symbolDefinition;
            }

            // Finally, check if this is a file reference
            // This is the lowest priority - only look for files if no local definitions are found
            if (this.isLikelyFileReference(word, document, position)) {
                logger.info(`No local definition found for ${word}, looking for file reference`);
                return await this.findFileDefinition(word, document.uri);
            }

            return null;
        } catch (error) {
            logger.error(`Error providing definition: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Finds the definition of a label in the current document
     */
    private async findLabelDefinition(word: string, document: TextDocument, position: Position): Promise<Definition | null> {
        logger.info(`Looking for label definition: ${word}`);

        // Get tokens from cache
        const tokens = this.tokenCache.getTokens(document);

        // Look for a label token that matches the word (labels are in column 1)
        const labelTokens = tokens.filter(token =>
            token.type === TokenType.Label &&
            token.value.toLowerCase() === word.toLowerCase() &&
            token.start === 0
        );

        if (labelTokens.length > 0) {
            logger.info(`Found ${labelTokens.length} label tokens for ${word}`);

            // Find the current scope (procedure, routine, etc.)
            const currentLine = position.line;
            const currentScope = this.getInnermostScopeAtLine(tokens, currentLine);


            // If we found a scope, first look for labels within that scope
            if (currentScope) {
                logger.info(`Current scope: ${currentScope.value} (${currentScope.line}-${currentScope.finishesAt})`);

                // Find labels in the current scope
                const scopedLabels = labelTokens.filter(token =>
                    token.line >= currentScope!.line &&
                    (currentScope!.finishesAt === undefined || token.line <= currentScope!.finishesAt)
                );

                if (scopedLabels.length > 0) {
                    logger.info(`Found ${scopedLabels.length} labels in current scope`);
                    const token = scopedLabels[0];

                    // Return the location of the label definition
                    return Location.create(document.uri, {
                        start: { line: token.line, character: 0 },
                        end: { line: token.line, character: token.value.length }
                    });
                }
            }

            // If no scoped labels were found, return the first label
            const token = labelTokens[0];

            // Return the location of the label definition
            return Location.create(document.uri, {
                start: { line: token.line, character: 0 },
                end: { line: token.line, character: token.value.length }
            });
        }

        return null;
    }
    /**
 * Returns the innermost enclosing procedure/routine/class for a given line
 */
    private getInnermostScopeAtLine(tokens: Token[], line: number): Token | undefined {
        const scopes = tokens.filter(token =>
            (token.subType === TokenType.Procedure ||
                token.subType === TokenType.Routine ||
                token.subType === TokenType.Class) &&
            token.line <= line &&
            (token.finishesAt === undefined || token.finishesAt >= line)
        );

        // Return the innermost (last matching) scope
        return scopes.length > 0 ? scopes[scopes.length - 1] : undefined;
    }

    /**
     * Finds the definition of a structure field reference
     * Handles both dot notation (Structure.Field) and prefix notation (PREFIX:Field)
     */
    private async findStructureFieldDefinition(word: string, document: TextDocument, position: Position): Promise<Definition | null> {
        logger.info(`Looking for structure field definition: ${word}`);

        // Get tokens from cache
        const tokens = this.tokenCache.getTokens(document);

        // Get the current line text to analyze the context
        const line = document.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: Number.MAX_VALUE }
        });

        // Check if this is a dot notation reference (Structure.Field or Complex:Structure:1.Field)
        const dotIndex = line.lastIndexOf('.');
        if (dotIndex > 0) {
            const structurePart = line.substring(0, dotIndex).trim();
            const fieldPart = line.substring(dotIndex + 1).trim();

            // Extract just the field name without any trailing characters
            const fieldMatch = fieldPart.match(/^(\w+)/);
            if (fieldMatch && fieldMatch[1].toLowerCase() === word.toLowerCase()) {
                const fieldName = fieldMatch[1];
                logger.info(`Detected dot notation: ${structurePart}.${fieldName}`);

                // Find the structure definition - handle complex structure names
                const structureTokens = tokens.filter(token =>
                    token.type === TokenType.Label &&
                    token.value.toLowerCase() === structurePart.toLowerCase() &&
                    token.start === 0
                );

                if (structureTokens.length > 0) {
                    // Find the field within the structure
                    return this.findFieldInStructure(tokens, structureTokens[0], fieldName, document, position);
                }
            }
        }

        // Check if this is a prefix notation reference (PREFIX:Field or Complex:Prefix:Field)
        const colonIndex = line.lastIndexOf(':');
        if (colonIndex > 0) {
            // Get everything before the last colon as the prefix
            const prefixPart = line.substring(0, colonIndex).trim();
            const fieldPart = line.substring(colonIndex + 1).trim();

            // Extract just the field name without any trailing characters
            const fieldMatch = fieldPart.match(/^(\w+)/);
            if (fieldMatch && fieldMatch[1].toLowerCase() === word.toLowerCase()) {
                const fieldName = fieldMatch[1];
                logger.info(`Detected prefix notation: ${prefixPart}:${fieldName}`);

                // Try to find structures with this exact prefix first
                let structuresWithPrefix = tokens.filter(token =>
                    token.type === TokenType.Structure &&
                    token.structurePrefix?.toLowerCase() === prefixPart.toLowerCase()
                );

                // If no exact match, try to find structures where the prefix is part of a complex name
                // For example, if prefixPart is "Queue:Browse:1", look for structures with prefix "Queue"
                if (structuresWithPrefix.length === 0 && prefixPart.includes(':')) {
                    const simplePrefixPart = prefixPart.split(':')[0];
                    structuresWithPrefix = tokens.filter(token =>
                        token.type === TokenType.Structure &&
                        token.structurePrefix?.toLowerCase() === simplePrefixPart.toLowerCase()
                    );
                }

                if (structuresWithPrefix.length > 0) {
                    // For each structure with this prefix, look for the field
                    for (const structureToken of structuresWithPrefix) {
                        // Find the label for this structure
                        const structureLabel = tokens.find(t =>
                            t.type === TokenType.Label &&
                            t.line === structureToken.line - 1 &&
                            t.start === 0
                        );

                        if (structureLabel) {
                            const result = await this.findFieldInStructure(tokens, structureLabel, fieldName, document, position);
                            if (result) return result;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Helper method to find a field within a structure
     */
    private async findFieldInStructure(
        tokens: Token[],
        structureToken: Token,
        fieldName: string,
        document: TextDocument,
        position?: Position
    ): Promise<Definition | null> {
        // First, try to find fields directly marked as structure fields
        let fieldTokens = tokens.filter(token =>
            token.type === TokenType.Label &&
            token.value.toLowerCase() === fieldName.toLowerCase() &&
            token.isStructureField === true &&
            token.structureParent?.parent?.value.toLowerCase() === structureToken.value.toLowerCase()
        );

        // If no fields found with the direct approach, try a more flexible approach
        if (fieldTokens.length === 0) {
            // Find the structure token that follows this label
            const structureIndex = tokens.indexOf(structureToken);
            let structureDefToken: Token | undefined;

            // Look for the structure definition after the label
            for (let i = structureIndex + 1; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.type === TokenType.Structure) {
                    structureDefToken = token;
                    break;
                }

                // If we hit another label or we've moved past the structure definition, stop looking
                if (token.type === TokenType.Label ||
                    (token.value.trim().length > 0 && !this.isStructureToken(token))) {
                    break;
                }
            }

            if (structureDefToken) {
                // Find the end of this structure
                const endLine = structureDefToken.finishesAt || Number.MAX_VALUE;

                // Look for field labels within this structure's range
                fieldTokens = tokens.filter(token =>
                    token.type === TokenType.Label &&
                    token.value.toLowerCase() === fieldName.toLowerCase() &&
                    token.line > structureDefToken!.line &&
                    token.line < endLine &&
                    token.start > 0  // Fields are indented
                );
            }
        }

        if (fieldTokens.length > 0) {
            logger.info(`Found ${fieldTokens.length} occurrences of field ${fieldName} in structure ${structureToken.value}`);

            // If we have a position, try to find the field in the current context first
            if (position) {
                const currentLine = position.line;

                // Find the current procedure/method context
                const currentContext = this.findCurrentContext(tokens, currentLine);
                if (currentContext) {
                    logger.info(`Current context: ${currentContext.value} (${currentContext.line}-${currentContext.finishesAt})`);

                    // First, try to find the field within the current context
                    const contextFields = fieldTokens.filter(token =>
                        token.line >= currentContext.line &&
                        (currentContext.finishesAt === undefined || token.line <= currentContext.finishesAt)
                    );

                    if (contextFields.length > 0) {
                        logger.info(`Found field ${fieldName} in current context ${currentContext.value}`);
                        const fieldToken = contextFields[0];

                        // Return the location of the field definition in the current context
                        return Location.create(document.uri, {
                            start: { line: fieldToken.line, character: 0 },
                            end: { line: fieldToken.line, character: fieldToken.value.length }
                        });
                    }
                }
            }

            // If we couldn't find the field in the current context, return the first occurrence
            const fieldToken = fieldTokens[0];
            logger.info(`Using first occurrence of field ${fieldName} at line ${fieldToken.line}`);

            // Return the location of the field definition
            return Location.create(document.uri, {
                start: { line: fieldToken.line, character: 0 },
                end: { line: fieldToken.line, character: fieldToken.value.length }
            });
        }

        return null;
    }

    /**
     * Find the current procedure/method context for a given line
     */
    private findCurrentContext(tokens: Token[], currentLine: number): Token | undefined {
        // First, look for method implementations (Class.Method)
        for (const token of tokens) {
            if (token.subType === TokenType.Class &&
                token.line <= currentLine &&
                (token.finishesAt === undefined || token.finishesAt >= currentLine)) {

                // Check if this is a method implementation (Class.Method)
                if (token.value && token.value.includes('.')) {
                    logger.info(`Found method context: ${token.value} for line ${currentLine}`);
                    return token;
                }
            }
        }

        // If no method found, look for procedure/routine
        for (const token of tokens) {
            if ((token.subType === TokenType.Procedure || token.subType === TokenType.Routine) &&
                token.line <= currentLine &&
                (token.finishesAt === undefined || token.finishesAt >= currentLine)) {
                logger.info(`Found procedure/routine context: ${token.value} for line ${currentLine}`);
                return token;
            }
        }

        return undefined;
    }

    /**
     * Finds the definition of a Clarion structure (queue, window, view, etc.)
     */
    private async findStructureDefinition(word: string, document: TextDocument, position: Position): Promise<Definition | null> {
        logger.info(`Looking for structure definition: ${word}`);

        // Get tokens from cache
        const tokens = this.tokenCache.getTokens(document);

        // Look for a label token that matches the word (structure definitions are labels in column 1)
        const labelTokens = tokens.filter(token =>
            token.type === TokenType.Label &&
            token.value.toLowerCase() === word.toLowerCase() &&
            token.start === 0
        );

        if (labelTokens.length > 0) {
            logger.info(`Found ${labelTokens.length} label tokens for ${word}`);

            // Find the structure token that follows the label
            for (const labelToken of labelTokens) {
                const labelIndex = tokens.indexOf(labelToken);

                // Look for a structure token after the label
                for (let i = labelIndex + 1; i < tokens.length; i++) {
                    const token = tokens[i];
                    if (token.type === TokenType.Structure) {
                        logger.info(`Found structure ${token.value} for label ${labelToken.value} at line ${token.line}`);

                        // Return the location of the structure definition
                        return Location.create(document.uri, {
                            start: { line: labelToken.line, character: 0 },
                            end: { line: labelToken.line, character: labelToken.value.length }
                        });
                    }

                    // If we hit another label or we've moved past the structure definition, stop looking
                    if (token.type === TokenType.Label ||
                        (token.value.trim().length > 0 && !this.isStructureToken(token))) {
                        break;
                    }
                }
            }
        }

        // If we didn't find a label token, look for a structure token with a matching name
        const structureTokens = tokens.filter(token =>
            token.type === TokenType.Structure &&
            token.parent &&
            token.parent.value.toLowerCase() === word.toLowerCase()
        );

        if (structureTokens.length > 0) {
            logger.info(`Found ${structureTokens.length} structure tokens for ${word}`);
            const token = structureTokens[0];

            // Return the location of the structure definition
            return Location.create(document.uri, {
                start: { line: token.line, character: token.start },
                end: { line: token.line, character: token.start + token.value.length }
            });
        }

        return null;
    }

    /**
     * Finds the definition of a variable or other symbol
     */
    /**
     * Checks if a token is a structure token
     */
    private isStructureToken(token: Token): boolean {
        return token.type === TokenType.Structure;
    }

    private async findSymbolDefinition(word: string, document: TextDocument, position: Position): Promise<Definition | null> {
        logger.info(`Looking for symbol definition: ${word}`);
    
        const tokens = this.tokenCache.getTokens(document);
        const currentLine = position.line;
        const currentScope = this.getInnermostScopeAtLine(tokens, currentLine);
    
        if (currentScope) {
            logger.info(`Current scope: ${currentScope.value} (${currentScope.line}-${currentScope.finishesAt})`);
        }
    
        const variableTokens = tokens.filter(token =>
            (token.type === TokenType.Variable ||
             token.type === TokenType.ReferenceVariable ||
             token.type === TokenType.ImplicitVariable) &&
            token.value.toLowerCase() === word.toLowerCase() &&
            token.start === 0 &&
            !(token.line === position.line &&
              position.character >= token.start &&
              position.character <= token.start + token.value.length)
        );
    
        if (variableTokens.length > 0) {
            logger.info(`Found ${variableTokens.length} variable tokens for ${word}`);
            variableTokens.forEach(token =>
                logger.info(`  -> Token: ${token.value} at line ${token.line}, type: ${token.type}, start: ${token.start}`)
            );
    
            if (currentScope) {
                const allScopes = this.getEnclosingScopes(tokens, currentScope);
                for (const scope of allScopes) {
                    const scopedVariables = variableTokens.filter(token =>
                        token.line >= scope.line &&
                        (scope.finishesAt === undefined || token.line <= scope.finishesAt)
                    );
                    if (scopedVariables.length > 0) {
                        logger.info(`✅ Found ${scopedVariables.length} variables in scope ${scope.value}`);
                        const token = scopedVariables[0];
                        return Location.create(document.uri, {
                            start: { line: token.line, character: token.start },
                            end: { line: token.line, character: token.start + token.value.length }
                        });
                    }
                }
            }
    
            logger.info(`🔁 No scoped match found; skipping to global lookup`);
        }
    
        // 🌍 Global fallback
        const globalLocation = await this.findGlobalDefinition(word, document.uri);
        if (globalLocation) return globalLocation;
    
        // 🎯 Try FILE structure fallback
        logger.info(`🧐 Still no match; checking for FILE label fallback`);

        tokens
            .filter(t => t.start === 0)
            .forEach(t => {
                logger.info(`   [${t.line}] ${t.type}${t.subType ? ` (${t.subType})` : ''} -> "${t.value}"`);
            });
        

        const labelToken = tokens.find(t =>
            t.type === TokenType.Label &&
            t.value.toLowerCase() === word.toLowerCase() &&
            t.start === 0
        );
    
        if (labelToken) {
            const labelIndex = tokens.indexOf(labelToken);
            for (let i = labelIndex + 1; i < tokens.length; i++) {
                logger.info(`Checking token ${i}: ${tokens[i].value} (${tokens[i].type})`);
                const t = tokens[i];
                if (t.type === TokenType.Structure && t.value.toUpperCase() === "FILE") {
                    logger.info(`📄 Resolved ${word} as FILE label definition`);
                    return Location.create(document.uri, {
                        start: { line: labelToken.line, character: 0 },
                        end: { line: labelToken.line, character: labelToken.value.length }
                    });
                }
                if (t.type === TokenType.Label) break;
            }
        }
    
        logger.info(`🛑 No matching global or local variable found — skipping fallback to random match`);
    
        // 🔎 Procedure/method fallback
        const procedureTokens = tokens.filter(token =>
            (token.subType === TokenType.Procedure ||
             token.subType === TokenType.Routine ||
             token.subType === TokenType.Class) &&
            token.value.toLowerCase() === word.toLowerCase()
        );
    
        if (procedureTokens.length > 0) {
            const token = procedureTokens[0];
            logger.info(`🔧 Matched procedure/routine/class for ${word}`);
            return Location.create(document.uri, {
                start: { line: token.line, character: token.start },
                end: { line: token.line, character: token.start + token.value.length }
            });
        }
    
        logger.info(`❌ Could not resolve definition for ${word} in current document, trying includes...`);
        
        // Try to find the definition in included files as a last resort
        const documentPath = document.uri.replace("file:///", "").replace(/\//g, "\\");
        const includeResult = await this.findDefinitionInIncludes(word, documentPath);
        if (includeResult) {
            logger.info(`✅ Found definition for ${word} in included file`);
            return includeResult;
        }
        
        logger.info(`❌ Could not resolve definition for ${word} in any file`);
        return null;
    }
    


    /**
 * Gets all enclosing scopes from innermost outward (L4 to L2) for fallback resolution
 */
    private getEnclosingScopes(tokens: Token[], innermost: Token): Token[] {
        const allScopes: Token[] = [];

        let current: Token | undefined = innermost;
        while (current) {
            allScopes.push(current);
            current = this.findEnclosingScope(tokens, current);
        }

        return allScopes;
    }

    /**
     * Finds the next outer scope that encloses the given token
     */
    private findEnclosingScope(tokens: Token[], inner: Token): Token | undefined {
        const candidates = tokens.filter(token =>
            (token.subType === TokenType.Procedure || token.subType === TokenType.Routine || token.subType === TokenType.Class) &&
            token.line < inner.line &&
            (token.finishesAt === undefined || token.finishesAt > inner.line)
        );

        // Return the closest enclosing one
        return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
    }

    /**
 * Extracts the filename from a MEMBER('...') declaration in the given tokens
 */
    private getMemberFileName(tokens: Token[]): string | null {
        const memberToken = tokens.find(token =>
            token.type === TokenType.ClarionDocument &&
            token.value.toUpperCase().startsWith("MEMBER(")
        );

        if (!memberToken) return null;

        const match = memberToken.value.match(/MEMBER\s*\(\s*['"](.+?)['"]\s*\)/i);
        return match ? match[1] : null;
    }

    /**
     * Gets the word range at the given position
     */
    private getWordRangeAtPosition(document: TextDocument, position: Position): Range | null {
        const line = document.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: Number.MAX_VALUE }
        });

        // Find the start and end of the word
        let start = position.character;
        while (start > 0 && this.isWordCharacter(line.charAt(start - 1))) {
            start--;
        }

        let end = position.character;
        while (end < line.length && this.isWordCharacter(line.charAt(end))) {
            end++;
        }

        if (start === end) {
            return null;
        }

        return {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end }
        };
    }

    /**
     * Checks if a character is part of a word
     */
    private isWordCharacter(char: string): boolean {
        return /[a-zA-Z0-9_\.]/.test(char);
    }

    /**
     * Determines if the word at the position is likely a file reference
     */
    private isLikelyFileReference(word: string, document: TextDocument, position: Position): boolean {
        // First, check if the word exists as a label in the document
        // If it does, it's more likely to be a reference to that label than a file
        const tokens = this.tokenCache.getTokens(document);

        // Check if there's a label with this name
        const labelExists = tokens.some(token =>
            token.type === TokenType.Label &&
            token.value.toLowerCase() === word.toLowerCase()
        );

        // If a label with this name exists, it's probably not a file reference
        if (labelExists) {
            logger.info(`Word "${word}" exists as a label in the document, not treating as file reference`);
            return false;
        }

        // Get the current line
        const line = document.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: Number.MAX_VALUE }
        });

        // Check for common Clarion file inclusion patterns
        const includePatterns = [
            /\bINCLUDE\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bUSE\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bIMPORT\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bEQUATE\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bFROM\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bSOURCE\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i,
            /\bMODULE\b\s*\(?(['"]?[\w\.]+['"]?)?\)?/i
        ];

        // Check if the line contains any of the include patterns
        let isIncludeLine = false;
        for (const pattern of includePatterns) {
            if (pattern.test(line)) {
                isIncludeLine = true;
                break;
            }
        }

        // If this is an include line, check if the word is part of it
        if (isIncludeLine) {
            for (const pattern of includePatterns) {
                const match = line.match(pattern);
                if (match) {
                    // If the pattern matched and the word is part of the match, it's likely a file reference
                    if (match[1] && match[1].includes(word)) {
                        logger.info(`Word "${word}" is part of an include pattern match`);
                        return true;
                    }

                    // If the pattern is on the same line as the word, it's likely a file reference
                    if (line.indexOf(word) > line.search(pattern)) {
                        logger.info(`Word "${word}" appears after an include pattern`);
                        return true;
                    }
                }
            }

            // Check if the word is surrounded by quotes or parentheses, which often indicates a file
            const wordStart = line.indexOf(word);
            if (wordStart > 0) {
                const prevChar = line.charAt(wordStart - 1);
                const nextCharPos = wordStart + word.length;
                const nextChar = nextCharPos < line.length ? line.charAt(nextCharPos) : '';

                if ((prevChar === '"' || prevChar === "'" || prevChar === '(') &&
                    (nextChar === '"' || nextChar === "'" || nextChar === ')' || nextChar === ',')) {
                    logger.info(`Word "${word}" is surrounded by quotes or parentheses in an include line`);
                    return true;
                }
            }
        }

        // If the word has a file extension and is not found as a label in the document,
        // it might be a file reference
        if (/\.(clw|inc|txa|tpl|tpw|trn|int|equ|def)$/i.test(word)) {
            logger.info(`Word "${word}" has a file extension and no matching label, treating as file reference`);
            return true;
        }

        return false;
    }
    /**
     * Recursively searches for a definition in INCLUDE files and falls back to MEMBER files
     * @param word The word to find
     * @param fromPath The file path to start searching from
     * @param visited Optional set of already visited files to prevent cycles
     * @returns A Location if found, null otherwise
     */
    private async findDefinitionInIncludes(word: string, fromPath: string, visited?: Set<string>): Promise<Location | null> {
        fromPath = decodeURIComponent(fromPath);
        // Initialize visited set if not provided
        if (!visited) {
            visited = new Set<string>();
        }

        // Prevent revisiting the same file
        if (visited.has(fromPath)) {
            logger.info(`Already visited ${fromPath}, skipping to prevent cycles`);
            return null;
        }

        // Mark this file as visited
        visited.add(fromPath);
        logger.info(`Searching for definition of '${word}' in file: ${fromPath}`);

        // Get the SolutionManager instance
        const solutionManager = SolutionManager.getInstance();
        if (!solutionManager) {
            logger.warn("No SolutionManager instance available");
            return null;
        }

        // Find the project for this file
        const project = solutionManager.findProjectForFile(fromPath);
        if (!project) {
            logger.warn(`No project found for file: ${fromPath}`);
            return null;
        }

        // Create a TextDocument for the file
        const fileContents = await project.readFileContents(fromPath);
        if (!fileContents) {
            logger.warn(`Could not read file contents: ${fromPath}`);
            return null;
        }

        const fileUri = `file:///${fromPath.replace(/\\/g, "/")}`;
        const document = TextDocument.create(fileUri, "clarion", 1, fileContents);

        // Tokenize the file
        const tokens = this.tokenCache.getTokens(document);

        // First, check if the word is defined in this file
        const labelToken = tokens.find(token =>
            token.start === 0 &&
            token.type === TokenType.Label &&
            token.value.toLowerCase() === word.toLowerCase()
        );

        if (labelToken) {
            logger.info(`Found label definition for '${word}' in ${fromPath} at line ${labelToken.line}`);
            return Location.create(document.uri, {
                start: { line: labelToken.line, character: 0 },
                end: { line: labelToken.line, character: labelToken.value.length }
            });
        }

        // INCLUDE Search Logic
        // Find all INCLUDE statements in the file, searching bottom-up
        const includeTokens = tokens.filter(token =>
            token.value.toUpperCase().includes('INCLUDE') &&
            token.value.includes("'")
        );

        // Process includes in reverse order (bottom-up)
        for (let i = includeTokens.length - 1; i >= 0; i--) {
            const includeToken = includeTokens[i];
            
            // Extract the include filename from the token value
            const match = includeToken.value.match(/INCLUDE\s*\(\s*['"](.+?)['"]\s*\)/i);
            if (!match || !match[1]) continue;
            
            const includeFileName = match[1];
            logger.info(`Found INCLUDE statement for '${includeFileName}' at line ${includeToken.line}`);
            
            // Use the project's redirection parser to resolve the actual file path
            const redirectionParser = project.getRedirectionParser();
            const includePath = redirectionParser.findFile(includeFileName);
            
            if (includePath && fs.existsSync(includePath)) {
                logger.info(`Resolved INCLUDE file path: ${includePath}`);
                
                // Recursively search in the included file
                const result = await this.findDefinitionInIncludes(word, includePath, visited);
                if (result) {
                    logger.info(`Found definition in included file: ${includePath}`);
                    return result;
                }
            } else {
                logger.warn(`Could not resolve INCLUDE file: ${includeFileName}`);
            }
        }

        // MEMBER Fallback Logic
        // If no definition found in includes, check for MEMBER statements
        const memberFileName = this.getMemberFileName(tokens);
        if (memberFileName) {
            logger.info(`Found MEMBER reference to '${memberFileName}'`);
            
            // Resolve the member file path
            const redirectionParser = project.getRedirectionParser();
            const memberPath = redirectionParser.findFile(memberFileName);
            
            if (memberPath && fs.existsSync(memberPath) && !visited.has(memberPath)) {
                logger.info(`Resolved MEMBER file path: ${memberPath}`);
                
                // Recursively search in the member file
                const result = await this.findDefinitionInIncludes(word, memberPath, visited);
                if (result) {
                    logger.info(`Found definition in member file: ${memberPath}`);
                    return result;
                }
            } else {
                logger.warn(`Could not resolve MEMBER file: ${memberFileName}`);
            }
        }

        logger.info(`No definition found for '${word}' in ${fromPath} or its includes/members`);
        return null;
    }

    private async findGlobalDefinition(word: string, documentUri: string): Promise<Location | null> {
        const solutionManager = SolutionManager.getInstance();
        if (!solutionManager) {
            logger.warn("❌ No SolutionManager instance available.");
            return null;
        }
    
        const documentPath = documentUri.replace("file:///", "").replace(/\//g, "\\");
        const currentProject = solutionManager.findProjectForFile(documentPath);
        if (!currentProject) {
            logger.warn(`❗ No project found for ${documentPath}`);
            return null;
        }
    
        const visited = new Set<string>();
    
        // 🔍 Step 1: Search known project source files
        for (const sourceFile of currentProject.sourceFiles) {
            const fullPath = path.join(currentProject.path, sourceFile.relativePath);
            if (!fs.existsSync(fullPath) || visited.has(fullPath)) continue;
    
            visited.add(fullPath);
            const contents = await currentProject.readFileContents(fullPath);
            if (!contents) continue;
    
            const doc = TextDocument.create(`file:///${fullPath.replace(/\\/g, "/")}`, "clarion", 1, contents);
            const tokens = this.tokenCache.getTokens(doc);
    
            const label = tokens.find(t =>
                t.start === 0 &&
                t.type === TokenType.Label &&
                t.value.toLowerCase() === word.toLowerCase()
            );
    
            if (label) {
                logger.info(`✅ Found global label: ${label.value} at line ${label.line} in ${fullPath}`);
                return Location.create(doc.uri, {
                    start: { line: label.line, character: label.start },
                    end: { line: label.line, character: label.start + label.value.length }
                });
            }
        }
    
        // 🔁 Step 2: Fallback — search all redirection paths
        logger.info(`↪️ Fallback: searching via redirection for ${word}`);
        const candidatePath = solutionManager.findFileWithExtension(`${word}.CLW`);
        if (candidatePath && fs.existsSync(candidatePath) && !visited.has(candidatePath)) {
            const contents = await fs.promises.readFile(candidatePath, "utf-8");
            const doc = TextDocument.create(`file:///${candidatePath.replace(/\\/g, "/")}`, "clarion", 1, contents);
            const tokens = this.tokenCache.getTokens(doc);
    
            const label = tokens.find(t =>
                t.start === 0 &&
                t.type === TokenType.Label &&
                t.value.toLowerCase() === word.toLowerCase()
            );
    
            if (label) {
                logger.info(`✅ Found global label via redirection: ${label.value} at line ${label.line} in ${candidatePath}`);
                return Location.create(doc.uri, {
                    start: { line: label.line, character: label.start },
                    end: { line: label.line, character: label.start + label.value.length }
                });
            }
        }
    
        // 🔁 Step 3: Try the recursive include search as a last resort
        logger.info(`↪️ Last resort: trying recursive include search for ${word}`);
        return await this.findDefinitionInIncludes(word, documentPath);
    }

    /**
     * Finds the definition location for a file reference
     */
    private async findFileDefinition(fileName: string, documentUri: string): Promise<Definition | null> {
        logger.info(`Finding definition for file: ${fileName}`);

        // Clean up the fileName - remove quotes and other non-filename characters
        fileName = fileName.replace(/['"()]/g, '').trim();

        const solutionManager = SolutionManager.getInstance();
        if (!solutionManager) {
            logger.warn('No solution manager instance available');
            return null;
        }

        // Extract the document path from the URI
        const documentPath = documentUri.replace('file:///', '').replace(/\//g, '\\');
        logger.info(`Document path: ${documentPath}`);

        // Find the project that contains the current document
        const project = solutionManager.findProjectForFile(documentPath);

        // If the fileName doesn't have an extension, try common Clarion extensions
        let filePath = '';
        if (!path.extname(fileName)) {
            const commonExtensions = ['.clw', '.inc', '.txa', '.tpl', '.tpw', '.trn', '.int', '.equ', '.def'];
            for (const ext of commonExtensions) {
                const fileWithExt = fileName + ext;

                // First try to find the file in the current project's search paths
                if (project) {
                    const searchPaths = project.getSearchPaths(ext);
                    for (const searchPath of searchPaths) {
                        const fullPath = path.join(searchPath, fileWithExt);
                        if (fs.existsSync(fullPath)) {
                            filePath = fullPath;
                            logger.info(`Found file in project search paths: ${filePath}`);
                            break;
                        }
                    }

                    if (filePath) break;
                }

                // If not found in project paths, try the global solution search
                if (!filePath) {
                    filePath = solutionManager.findFileWithExtension(fileWithExt);
                    if (filePath) {
                        logger.info(`Found file with extension ${ext} in solution: ${filePath}`);
                        break;
                    }
                }
            }
        } else {
            // First try to find the file in the current project's search paths
            if (project) {
                const ext = path.extname(fileName);
                const searchPaths = project.getSearchPaths(ext);
                for (const searchPath of searchPaths) {
                    const fullPath = path.join(searchPath, fileName);
                    if (fs.existsSync(fullPath)) {
                        filePath = fullPath;
                        logger.info(`Found file in project search paths: ${filePath}`);
                        break;
                    }
                }
            }

            // If not found in project paths, try the global solution search
            if (!filePath) {
                filePath = solutionManager.findFileWithExtension(fileName);
            }
        }

        if (!filePath || !fs.existsSync(filePath)) {
            logger.warn(`File not found: ${fileName}`);
            return null;
        }

        logger.info(`Found file: ${filePath}`);

        // Convert file path to URI format
        const fileUri = `file:///${filePath.replace(/\\/g, '/')}`;

        // Return the location at the beginning of the file
        return Location.create(fileUri, {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 }
        });
    }
}