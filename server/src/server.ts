import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    FoldingRange,
    FoldingRangeRequestParam
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClarionFoldingRangeProvider } from './ClarionFoldingRangeProvider';

let connection = createConnection(ProposedFeatures.all);
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize(params => {
    
    connection.onFoldingRanges(params =>
        {
            return getFoldingRanges(params);
        }
    );

    return {
        capabilities: {
           foldingRangeProvider: true
        }
    };
});

connection.onInitialized(() => {
    connection.window.showInformationMessage('Clarion Server Initialized');
});


function getFoldingRanges(params: FoldingRangeRequestParam): FoldingRange[] {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    let clarionFolding: ClarionFoldingRangeProvider = new ClarionFoldingRangeProvider;
    
    return clarionFolding.provideFoldingRanges(document); 
}
documents.listen(connection);
connection.listen();
