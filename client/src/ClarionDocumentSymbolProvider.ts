import * as vscode from 'vscode';

export class ClarionDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    private format(cmd: string):string{
        return cmd.substr(1).toLowerCase().replace(/^\w/, c => c.toUpperCase())
    }

    public provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[]> 
        {
        return new Promise((resolve, reject) => 
        {
            let symbols: vscode.DocumentSymbol[] = [];
            let nodes = [symbols]

            let inside_member = false
            let inside_procedure = false
            let inside_routine = false
            let parsing_procedure = false
            let procedure_string = ""

            const symbolkind_member = vscode.SymbolKind.Module
            const symbolkind_procedure = vscode.SymbolKind.Method
            const symbolkind_routine = vscode.SymbolKind.Property


            const member_match_exp = new RegExp("^\\s*member\\s*\\(\\s*'(?<filename>\\S+)'\\s*\\)","igm")
            let hasModuleName = false

            const procedure_header_exp = new RegExp("^(?<name>\\S+)\\s+procedure","igm")
            const procedure_match_exp = new RegExp("^(?<name>\\S+)\\s+procedure\\((?<args>.*)\\)(,(?<virtual>virtual))?","igm")
            const routine_match_exp = new RegExp("^(?<name>\\S+)\\s+routine","igm")


            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);
                if (line.isEmptyOrWhitespace || line.text.startsWith("!"))
                    continue;

                //let tokens = line.text.split(" ");
                let tokens = line.text.split(/\s+/);

                if (!inside_member){
                    // "   MEMBER('UTL2.clw')                                     !App=UTL2"
                    const member_matches = member_match_exp.exec(line.text)
                    if (member_matches !== null && 
                        member_matches.groups?.filename){
                        let member_symbol = new vscode.DocumentSymbol(
                            member_matches.groups.filename,  // filename:"UTL2.clw"
                            "app",
                            symbolkind_member,
                            line.range,line.range
                        )

                        nodes[nodes.length-1].push(member_symbol)
                        nodes.push(member_symbol.children)
                        inside_member = true
                        continue;
                    }
                }

                // "Treat     procedure()"
                if (!line.text.startsWith(" ") && !parsing_procedure){
                    if (procedure_header_exp.test(line.text)){
                        procedure_string = ""
                        parsing_procedure = true
                    }
                }
                if(parsing_procedure){
                    procedure_string += line.text
                    let procedure_matches = procedure_match_exp.exec(procedure_string)
                    if (procedure_matches !== null && 
                        procedure_matches.groups?.name){
                        let procedure_symbol = new vscode.DocumentSymbol(
                            procedure_matches.groups.name,  // name:"Treat"
                            "procedure",
                            symbolkind_procedure,
                            line.range,line.range
                        )
                        if (procedure_matches.groups?.args){ // has additional procedure arguments
                            procedure_symbol.name+="(...)"
                        }

                        if (inside_routine){
                            nodes.pop()
                            inside_routine = false
                        }
                        else if(inside_procedure){
                            nodes.pop()
                            inside_procedure = false
                            inside_routine = false
                        }
                        nodes[nodes.length-1].push(procedure_symbol)
                        nodes.push(procedure_symbol.children)
                        inside_procedure = true

                        parsing_procedure = false
                        procedure_string=""
                        continue;
                    }
                }

                if (!line.text.startsWith(" ")){
                    // "LoadData    routine"
                    let routine_matches = routine_match_exp.exec(line.text)
                    if (routine_matches !== null && 
                        routine_matches.groups?.name){
                        let routine_symbol = new vscode.DocumentSymbol(
                            routine_matches.groups.name,  // name:"LoadData"
                            "routine",
                            symbolkind_routine,
                            line.range,line.range
                        )

                        nodes[nodes.length-1].push(routine_symbol)
                        inside_routine = true
                        continue;
                    }
                }
            }

            resolve(symbols);
        });
    }
}