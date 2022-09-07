import * as path from 'path';
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

export class DeclarationReferences {
    id: number;
    referencedDeclarationStrings: string[] = new Array<string>();
    referenceIds: number[] = new Array<number>();
    constructor(id: number) {
        this.id = id;
    }
}

export class ProjectIndexer {
    private options: ProjectOptions;
    private program: ts.Program;
    private checker: ts.TypeChecker;
    private symbolCache: Map<ts.Node, LsifSymbol> = new Map();
    private packages: Packages;
    constructor(public readonly config: ts.ParsedCommandLine, options: ProjectOptions) {
        this.options = options;
        this.program = ts.createProgram(config.fileNames, config.options);
        this.checker = this.program.getTypeChecker();
        this.packages = new Packages(options.projectRoot);
    }
    public index(): void {
        const startTimestamp = Date.now();
        const sourceFiles = this.program.getSourceFiles();

        const references: Map<string, DeclarationReferences> = new Map<string, DeclarationReferences>();

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
            this.emitDocument(title, sourceFile);
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
                references
            );
            try {
                visitor.index();
            } catch (error) {
                console.error(`unexpected error indexing project root '${this.options.cwd}'`, error);
            }
            if (visitor.document.occurrences.length > 0) {
                this.options.writeIndex(
                    new lsif.lib.codeintel.lsiftyped.Index({
                        documents: [visitor.document],
                    })
                );
            }
        }
        console.log('=====');
        console.log(references);
        console.log('-----');
        this.emitReferences(references);
        console.log('=====');
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
     * Emits a referenceResult row to the LSIF output
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
     * Emits a referenceResult row to the LSIF output
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
     * Emits a referenceResult row to the LSIF output
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

    private emitReferences(references: Map<string, DeclarationReferences>) {
        let referenceRelationships: Map<number, number[]> = new Map<number, number[]>();
        references.forEach((declarationReferences, _) => {
            declarationReferences.referencedDeclarationStrings.forEach((referencedDeclarationString) => {
                let referencedId = references.get(referencedDeclarationString)?.id;
                if (referencedId !== undefined) {
                    console.log(`${referencedId} is referenced by ${declarationReferences.id}`);
                    if (referenceRelationships.has(referencedId)) {
                        referenceRelationships.get(referencedId)!.push(declarationReferences.id);
                    } else {
                        referenceRelationships.set(referencedId, [declarationReferences.id]);
                    }
                }
            });
        });
        console.log('referenceRelationships', referenceRelationships);
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
