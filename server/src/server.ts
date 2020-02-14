import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import { CompletionItem, CompletionItemKind, createConnection, Diagnostic, DiagnosticSeverity, DidChangeConfigurationNotification, InitializeParams, Position, ProposedFeatures, TextDocument, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver'
import { normalizeURI } from './util'

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments()

let hasWorkspaceConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasDiagnosticRelatedInformationCapability: boolean = false

interface asm6fSettings {
    assemblerPath: string
    mainFile: string
    outFile: string
}

const defaultSettings: asm6fSettings = { assemblerPath: 'asm6f_64', mainFile: 'main.asm', outFile: '' }

/**
 * Fallback for clients without workspace configuration.  
 * This should not be accessed directly, use `getDocumentSettings` instead.
 */
let globalSettings: asm6fSettings = defaultSettings

/**
 * Cached version of settings for each opened document.   
 * This map should not be accessed directly, use `getDocumentSettings` instead.  
 */
let documentSettings: Map<string, Thenable<asm6fSettings>> = new Map()

connection.onInitialize((params: InitializeParams) => {
    let capabilities = params.capabilities

    // Does the client support workspace configuration?
    // If not, we will fall back using global settings
    hasWorkspaceConfigurationCapability = capabilities.workspace?.configuration ?? false
    hasWorkspaceFolderCapability = capabilities.workspace?.workspaceFolders ?? false
    hasDiagnosticRelatedInformationCapability = capabilities.textDocument?.publishDiagnostics?.relatedInformation ?? false

    return {
        capabilities: {
            textDocumentSync: documents.syncKind,
            // Tell the client that the server supports code completion
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.']
            },
        }
    }
})

connection.onInitialized(() => {
    if (hasWorkspaceConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined)
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.')
        })
    }
})

connection.onDidChangeConfiguration(change => {
    if (hasWorkspaceConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear()
    } else {
        globalSettings = <asm6fSettings>(
            (change.settings?.asm6fLang ?? defaultSettings)
        )
    }

    // Revalidate all open text documents
    // documents.all().forEach(validate)
})

const getDocumentSettings = (resource: string): Thenable<asm6fSettings> => {
    if (!hasWorkspaceConfigurationCapability) {
        return Promise.resolve(globalSettings)
    }
    let result = documentSettings.get(resource)
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'asm6fLang'
        })
        documentSettings.set(resource, result)
    }
    return result
}

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(normalizeURI(e.document.uri))
})


// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    // TODO realtime validation
    // validateDocument(change.document)
})

documents.onDidSave((change) => {
    validate(change.document)
})

const validate = async (textDocument: TextDocument): Promise<void> => {

    const settings = await getDocumentSettings(normalizeURI(textDocument.uri))

    console.log('validating..')
    const assembler = spawn(settings.assemblerPath, [settings.mainFile, settings.outFile])

    let diagnostics = new Map<string, Diagnostic[]>()
    documentSettings.forEach((_v, k) => diagnostics.set(k, []))

    assembler.stdout.on('data', (chunk) => console.log(`${chunk}`))

    assembler.stderr.on('data', (chunk: Buffer) => {
        console.log(`${chunk}`)

        // this is a bit of a hack but it works for now
        for (let message of chunk.toString().trim().split('\n')) {

            // split the error message
            const match = message.match(/(.+)\((\d+)\): (.+)\./)
            if (match === null) {
                connection.window.showErrorMessage(`${chunk}`)
                continue
            }

            const [, file, line_string, reason] = match
            const line_number = Number(line_string) - 1

            let diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: Position.create(line_number, 0),
                    end: Position.create(line_number, Number.MAX_SAFE_INTEGER),
                },
                message: reason,
                source: 'asm6f-lang'
            }


            // console.log(`can related info: ${hasDiagnosticRelatedInformationCapability}`)
            // if (hasDiagnosticRelatedInformationCapability) {
            //     diagnostic.relatedInformation = [
            //         {
            //             location: {
            //                 uri: textDocument.uri,
            //                 range: diagnostic.range
            //             },
            //             message: diagnostic.message
            //         }
            //     ]
            // }

            const uri = pathToFileURL(file).toString()
            if (!diagnostics.has(uri)) diagnostics.set(uri, [])

            diagnostics.get(uri)!.push(diagnostic)
        }
    })

    // Send the computed diagnostics to the editor
    assembler.on("exit", () => {
        console.log(`done, sending diagnostics`)
        console.log(diagnostics)
        diagnostics.forEach((v, k) => connection.sendDiagnostics({ uri: k, diagnostics: v }))
    })



}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in the client
    connection.console.log('We received an file change event')
})



// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The passed parameter contains the position in the text document
    // where code completion was requested. Here we ignore this
    // info and always provide the same completion items.
    return [
        {
            label: 'lda',
            kind: CompletionItemKind.Keyword,
            data: 1,
        },
        {
            label: 'ldx',
            kind: CompletionItemKind.Keyword,
            data: 2,
        }
    ]
})

// This handler resolves additional information for the item selected in the completion list
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    console.log('completionresolve')
    switch (item.data) {
        case 1:
            item.detail = 'Load Accumulator'
            item.documentation = 'TODO'
            break
        case 2:
            item.detail = 'Load X'
            item.documentation = 'TODO'
            break
    }
    return item
})

connection.onDidOpenTextDocument((params) => {
    // A text document got opened in VSCode.
    // params.textDocument.uri uniquely identifies the document. For documents store on disk this is a file URI.
    // params.textDocument.text the initial full content of the document.
    connection.console.log(`${params.textDocument.uri} opened`)
})

connection.onDidChangeTextDocument((params) => {
    // The content of a text document did change in VSCode.
    // params.textDocument.uri uniquely identifies the document.
    // params.contentChanges describe the content changes to the document.
    // connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`)
})

connection.onDidCloseTextDocument((params) => {
    // A text document got closed in VSCode.
    // params.textDocument.uri uniquely identifies the document.
    connection.console.log(`${params.textDocument.uri} closed`)
})

// Make the text document manager listen on the connection for text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
