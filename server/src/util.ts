import { uriToFilePath } from 'vscode-languageserver/lib/files'
import { pathToFileURL } from 'url'

export const normalizeURI = (uri: string) => pathToFileURL(uriToFilePath(uri) ?? '').href
