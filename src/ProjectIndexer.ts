import * as path from 'path';
import * as fs from 'fs';
import { Writable as WritableStream } from 'stream';

import prettyMilliseconds from 'pretty-ms';
import ProgressBar from 'progress';
import * as ts from 'typescript';

import { ProjectOptions } from './CommandLineOptions';
import { FileIndexer } from './FileIndexer';
import { Input } from './Input';
import * as lsif from './lsif';
import { LsifSymbol } from './LsifSymbol';
import { Packages } from './Packages';
import { DefinitionsReferencesItem, Document, ReferenceResult, ResultSet, TextDocumentEdge } from './lsif-data/lsif';
import { DefinitionRange } from './DefinitionRange';

export class ProjectIndexer {
    private options: ProjectOptions;
    private program: ts.Program;
    private checker: ts.TypeChecker;
    private symbolCache: Map<ts.Node, LsifSymbol> = new Map();
    private packages: Packages;
    constructor(public readonly config: ts.ParsedCommandLine, options: ProjectOptions) {
        this.options = options;
        if (this.options.dev) console.log('config.options', config.options);
        this.program = ts.createProgram(config.fileNames, config.options);
        this.checker = this.program.getTypeChecker();
        this.packages = new Packages(options.projectRoot);
    }
    public index(): void {
        const startTimestamp = Date.now();
        const sourceFiles = this.program.getSourceFiles();

        const declarations: Map<number, DefinitionRange> = new Map<number, DefinitionRange>();
        const references: Map<number, DefinitionRange[]> = new Map<number, DefinitionRange[]>();

        const filesToIndex: ts.SourceFile[] = [];
        // Visit every sourceFile in the program
        for (const sourceFile of sourceFiles) {
            const includes = this.config.fileNames.includes(sourceFile.fileName);
            if (!includes) {
                continue;
            }
            filesToIndex.push(sourceFile);
        }

        if (filesToIndex.length === 0) {
            throw new Error(`no indexable files in project '${this.options.projectDisplayName}'`);
        }

        const languageService = createLanguageService(
            filesToIndex.map(function (file) {
                return file.fileName;
            }),
            {}
        );

        const jobs = new ProgressBar(`  ${this.options.projectDisplayName} [:bar] :current/:total :title`, {
            total: filesToIndex.length,
            renderThrottle: 100,
            incomplete: '_',
            complete: '#',
            width: 20,
            clear: true,
            stream: this.options.progressBar ? process.stderr : writableNoopStream(),
        });
        let lastWrite = startTimestamp;
        for (const [index, sourceFile] of filesToIndex.entries()) {
            const title = path.relative(this.options.cwd, sourceFile.fileName);
            jobs.tick({ title });
            if (!this.options.progressBar) {
                const now = Date.now();
                const elapsed = now - lastWrite;
                if (elapsed > 1000 && index > 2) {
                    lastWrite = now;
                    process.stdout.write('.');
                }
            }
            const document = new lsif.lib.codeintel.lsiftyped.Document({
                relative_path: title,
                occurrences: [],
            });
            this.emitDocument(`${this.options.cwd}/${title}`, sourceFile);
            const input = new Input(sourceFile.fileName, sourceFile.getText());
            const visitor = new FileIndexer(
                this.checker,
                input,
                document,
                this.symbolCache,
                this.packages,
                sourceFile,
                this.options.writeIndex,
                this.options.counter,
                declarations,
                references,
                languageService,
                this.options.dev
            );
            try {
                visitor.index();
            } catch (error) {
                console.error(`unexpected error indexing project root '${this.options.cwd}'`, error);
            }
        }
        this.emitReferences(declarations, references);
        jobs.terminate();
        const elapsed = Date.now() - startTimestamp;
        if (!this.options.progressBar && lastWrite > startTimestamp) {
            process.stdout.write('\n');
        }
        console.log(`+ ${this.options.projectDisplayName} (${prettyMilliseconds(elapsed)})`);
    }

    public emitDocument(documentPath: string, sourceFile: ts.SourceFile): number {
        let id = this.options.counter.next();
        let document = new Document({
            id,
            type: 'vertex',
            label: 'document',
            uri: documentPath,
            languageId: sourceFile.flags & ts.NodeFlags.JavaScriptFile ? 'javascript' : 'typescript',
        });

        this.options.writeIndex(document);
        return id;
    }

    /**
     * Emits resultSet row to LSIF output
     *
     * @returns {number} The id of the row
     */
    public emitResultSet(): number {
        let id = this.options.counter.next();
        let resultSet = new ResultSet({ id, type: 'vertex', label: 'resultSet' });
        this.options.writeIndex(resultSet);
        return id;
    }

    /**
     * Emits a referenceResult row to the LSIF output
     *
     * @returns {number} The id of the row
     */
    public emitReferenceResult(): number {
        let id = this.options.counter.next();
        let resultSet = new ReferenceResult({ id, type: 'vertex', label: 'referenceResult' });
        this.options.writeIndex(resultSet);
        return id;
    }

    /**
     * Emits a textDocument edge row to the LSIF output
     *
     * @param {number}  inV - The corresponding input vertex (row.id)
     * @param {string} textDocumentType - The type of textDocument edge to emit
     * @returns {number} The id of the row
     */
    public emitTextDocumentEdge(inV: number, textDocumentType: string): number {
        let id = this.options.counter.next();
        let textDocumentEdge = new TextDocumentEdge({
            id,
            type: 'edge',
            label: `textDocument/${textDocumentType}`,
            inV,
        });
        this.options.writeIndex(textDocumentEdge);
        return id;
    }

    /**
     * Emits a item edge row to the LSIF output
     *
     * @param {number[]}  inVs - The corresponding input vertexes (row.id)
     * @param {number} outV - The corresponding output vertex (row.id)
     * @param {string} property - Either 'definitions' or 'references', corresponding to the record type
     * @returns {number} The id of the row
     */
    public emitItemForDefinitionsOrReferences(inVs: number[], outV: number, property: string): number {
        if (property !== 'definitions' && property !== 'references') {
            throw new Error(`Property (${property}) is not one of ('definitions', 'references')`);
        }
        if (inVs.length === 0) return this.options.counter.get();
        if (property === 'definitions' && inVs.length !== 1) {
            throw new Error(`Definitions can only be singular (inVs.length :: ${inVs.length} !== 1)`);
        }
        let id = this.options.counter.next();
        let item = new DefinitionsReferencesItem({
            id,
            type: 'edge',
            label: 'item',
            outV,
            inVs,
            property,
        });
        this.options.writeIndex(item);
        return id;
    }

    /**
     * Emits reference/definition rows to the LSIF output
     *
     * @param {number} definitionRangeId - The id of the component definition being referenced
     * @param {number[]} referenceRangeIds - The ids of all components referencing the definition
     * @returns {number} The id of the row last-emitted
     */
    public emitReferencesForDeclaration(definitionRangeId: number, referenceRangeIds: number[]): number {
        let referenceResultId = this.emitReferenceResult();
        this.emitTextDocumentEdge(referenceResultId, 'references');
        this.emitItemForDefinitionsOrReferences([definitionRangeId], referenceResultId, 'definitions');
        return this.emitItemForDefinitionsOrReferences(referenceRangeIds, referenceResultId, 'references');
    }

    private emitReferences(declarations: Map<number, DefinitionRange>, references: Map<number, DefinitionRange[]>) {
        if (this.options.dev) console.log('emitReferences');
        let referenceRelationships: Map<number, number[]> = new Map<number, number[]>();

        const declarationEntries = [...declarations.entries()];
        for (let [referencedId, referenceRanges] of references) {
            for (let referenceRange of referenceRanges) {
                let sameFiles = declarationEntries.filter(([declarationId, declarationRange]) => {
                    return referenceRange.sourceFile == declarationRange.sourceFile;
                });
                let rangeOverlaps = sameFiles.filter(([declarationId, declarationRange]) => {
                    return declarationRange.range.contains(referenceRange.range);
                });
                if (rangeOverlaps.length == 0) continue;

                // Returns the id of the most-nested component to ensure that only the smallest parent is marked as the parent.
                let [overlapId] = rangeOverlaps.reduce((previous, current) => {
                    let [, previousDefinitionRange] = previous;
                    let [, currentDefinitionRange] = current;
                    return previousDefinitionRange.range.contains(currentDefinitionRange.range) ? current : previous;
                });

                if (referencedId == overlapId) continue;

                if (referenceRelationships.has(referencedId)) {
                    referenceRelationships.get(referencedId)?.push(overlapId);
                    continue;
                }
                referenceRelationships.set(referencedId, [overlapId]);
            }
        }

        referenceRelationships.forEach((referenceRangeIds, definitionRangeId) => {
            this.emitReferencesForDeclaration(definitionRangeId, referenceRangeIds);
        });
    }
}

function writableNoopStream(): WritableStream {
    return new WritableStream({
        write(_unused1, _unused2, callback) {
            setImmediate(callback);
        },
    });
}

export function createLanguageService(rootFileNames: string[], options: ts.CompilerOptions): ts.LanguageService {
    const files: ts.MapLike<{ version: number }> = {};

    // initialize the list of files
    rootFileNames.forEach((fileName) => {
        files[fileName] = { version: 0 };
    });

    const servicesHost: ts.LanguageServiceHost = {
        getScriptFileNames: () => rootFileNames,
        getScriptVersion: (fileName) => files[fileName] && files[fileName].version.toString(),
        getScriptSnapshot: (fileName) => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }

            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: () => process.cwd(),
        getCompilationSettings: () => options,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };

    // Create the language service files
    const services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
    return services;
}
