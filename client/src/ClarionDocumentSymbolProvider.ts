import * as vscode from 'vscode';

export class ClarionDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    private format(cmd: string): string {
        return cmd.substr(1).toLowerCase().replace(/^\w/, c => c.toUpperCase())
    }

    public provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[]> {
        return new Promise((resolve, reject) => {
            let symbols: vscode.DocumentSymbol[] = [];
            let nodes = [symbols]

            let inside_member = false
            let inside_procedure = false
            let inside_routine = false
            let is_parsing_procedure = false
            let procedure_name_string = ""

            const symbolkind_member = vscode.SymbolKind.Module
            const symbolkind_procedure = vscode.SymbolKind.Method
            const symbolkind_routine = vscode.SymbolKind.Property
            const symbolkind_variable = vscode.SymbolKind.Variable

            const member_match_exp = new RegExp("^\\s*member\\s*\\(\\s*'(?<filename>\\S+)'\\s*\\)", "igm")
            const procedure_header_exp = new RegExp("^(?<name>\\S+)\\s+procedure", "igm")
            const procedure_match_exp = new RegExp("^(?<name>\\S+)\\s+procedure\\((?<args>.*)\\)(,(?<virtual>virtual))?", "igm")
            const routine_match_exp = new RegExp("^(?<name>\\S+)\\s+routine", "igm")
            const variable_match_exp = new RegExp("^(?<name>\\S+)\\s+", "igm")

            let member_symbol: vscode.DocumentSymbol = null
            let procedure_symbol: vscode.DocumentSymbol = null
            let routine_symbol: vscode.DocumentSymbol = null
            let variable_symbol: vscode.DocumentSymbol = null

            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);
                if (line.isEmptyOrWhitespace || line.text.trim().startsWith("!"))
                    continue;

                //let tokens = line.text.split(" ");
                //let tokens = line.text.split(/\s+/);

                if (!inside_member) {
                    // "   MEMBER('UTL2.clw')                                     !App=UTL2"
                    member_match_exp.lastIndex = 0
                    const member_matches = member_match_exp.exec(line.text)
                    if (member_matches !== null &&
                        member_matches.groups?.filename) {
                        member_symbol = new vscode.DocumentSymbol(
                            member_matches.groups.filename,  // filename:"UTL2.clw"
                            "",
                            symbolkind_member,
                            line.range, line.range
                        )

                        nodes[nodes.length - 1].push(member_symbol)
                        nodes.push(member_symbol.children)
                        inside_member = true
                        continue;
                    }
                }

                // "Treat     procedure()"
                if (!line.text.startsWith(" ") && !is_parsing_procedure) {  // the Procedure declaration could multiline. Find the beginning of the Procedure
                    procedure_header_exp.lastIndex = 0
                    if (procedure_header_exp.test(line.text)) {
                        procedure_name_string = ""
                        is_parsing_procedure = true
                    }
                }
                if (is_parsing_procedure) {
                    procedure_name_string += line.text
                    procedure_match_exp.lastIndex = 0
                    let procedure_matches = procedure_match_exp.exec(procedure_name_string)
                    // Hit. This is a procedure
                    if (procedure_matches !== null &&
                        procedure_matches.groups?.name) {
                        procedure_symbol = new vscode.DocumentSymbol(
                            procedure_matches.groups.name,  // name:"Treat"
                            "",
                            symbolkind_procedure,
                            line.range, line.range
                        )
                        if (procedure_matches.groups?.args) { // has additional procedure arguments
                            procedure_symbol.name += "(...)"
                        }

                        // Since Clarion Procedure has no explicit section end symbol.
                        // When any ongoing Routing or Procedure meet the new Procedure, seal the previous section
                        if (inside_routine) {
                            nodes.pop()
                            inside_routine = false
                        }
                        if (inside_procedure) {
                            nodes.pop()
                            inside_procedure = false
                        }

                        nodes[nodes.length - 1].push(procedure_symbol)
                        nodes.push(procedure_symbol.children)
                        inside_procedure = true

                        is_parsing_procedure = false
                        procedure_name_string = ""
                        continue;
                    }
                }

                if (!line.text.startsWith(" ")) {
                    // "LoadData    routine"
                    routine_match_exp.lastIndex = 0
                    let routine_matches = routine_match_exp.exec(line.text)
                    if (routine_matches !== null &&
                        routine_matches.groups?.name) {
                        routine_symbol = new vscode.DocumentSymbol(
                            routine_matches.groups.name,  // name:"LoadData"
                            "",
                            symbolkind_routine,
                            line.range, line.range
                        )

                        // Since Clarion Procedure has no explicit section end symbol.
                        // When any ongoing Routing meet the new Procedure, seal the previous section
                        if (inside_routine) {
                            nodes.pop()
                            inside_routine = false
                        }

                        nodes[nodes.length - 1].push(routine_symbol)
                        nodes.push(routine_symbol.children)
                        inside_routine = true
                        continue;
                    }
                }

                if (!line.text.startsWith(" ")) {
                    // "NumberOfAttempts           short"
                    variable_match_exp.lastIndex = 0
                    let variable_matches = variable_match_exp.exec(line.text)   // variable could be attached in any section, such as Procedure or Routine
                    if (variable_matches !== null &&
                        variable_matches.groups?.name) {
                        variable_symbol = new vscode.DocumentSymbol(
                            variable_matches.groups.name,  // name:"NumberOfAttempts"
                            "",
                            symbolkind_variable,
                            line.range, line.range
                        )

                        nodes[nodes.length - 1].push(variable_symbol)
                        continue;
                    }
                }
            }

            resolve(symbols);
        });
    }
}