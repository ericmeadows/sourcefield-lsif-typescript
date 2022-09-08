import * as ts from 'typescript';

import { Counter } from './Counter';
import { DefinitionRange } from './DefinitionRange';
import {
    metaDescriptor,
    methodDescriptor,
    packageDescriptor,
    parameterDescriptor,
    termDescriptor,
    typeDescriptor,
    typeParameterDescriptor,
} from './Descriptor';
import { Input } from './Input';
import * as lsif from './lsif';
import { FullRange, Moniker, Position, Range as LsifRange, ResultSet } from './lsif-data/lsif';
import { LsifSymbol } from './LsifSymbol';
import { Packages } from './Packages';
import { ParentChildRelationships } from './ParentChildRelationships';
import { Range } from './Range';
import * as ts_inline from './TypeScriptInternal';

type Descriptor = lsif.lib.codeintel.lsiftyped.Descriptor;

export class FileIndexer {
    private localCounter = new Counter();
    private propertyCounters: Map<string, Counter> = new Map();
    private localSymbolTable: Map<ts.Node, LsifSymbol> = new Map();
    private parentChildRelationships: ParentChildRelationships[] = Array<ParentChildRelationships>();
    private parentChildRelationshipsModuleLevel: ParentChildRelationships[] = Array<ParentChildRelationships>();

    constructor(
        public readonly checker: ts.TypeChecker,
        public readonly input: Input,
        public readonly document: lsif.lib.codeintel.lsiftyped.Document,
        public readonly globalSymbolTable: Map<ts.Node, LsifSymbol>,
        public readonly packages: Packages,
        public readonly sourceFile: ts.SourceFile,
        public readonly writeIndex: (index: any) => void,
        public readonly lsifCounter: Counter,
        public readonly definitions: Map<number, DefinitionRange> = new Map<number, DefinitionRange>(),
        public readonly references: Map<number, DefinitionRange[]>,
        public readonly languageService: ts.LanguageService
    ) {}
    public index(): void {
        this.visit(this.sourceFile);
        for (let parentChildRelationshipModuleLevel of this.parentChildRelationshipsModuleLevel) {
            if (parentChildRelationshipModuleLevel.children.length == 0) continue;
            this.writeIndex(parentChildRelationshipModuleLevel.getEmittable(this.lsifCounter.next()));
        }
    }

    private visit(node: ts.Node): void {
        let prevId = this.lsifCounter.get();
        let id = this.visitDeclaration(node);
        if (prevId == id) {
            ts.forEachChild(node, (node) => this.visit(node));
            return;
        }
        let parentChildRelationship = new ParentChildRelationships(id, this.parentChildRelationships.length == 0);
        this.parentChildRelationships.push(parentChildRelationship);
        ts.forEachChild(node, (node) => this.visit(node));
        let child = this.parentChildRelationships.pop();
        if (child === undefined) return;
        if (this.parentChildRelationships.length == 0) {
            this.parentChildRelationshipsModuleLevel.push(child);
            return;
        }
        this.parentChildRelationships[this.parentChildRelationships.length - 1].children.push(child);
    }

    private getDeclarationKind(declaration: ts.Node): number {
        if (ts.isModuleDeclaration(declaration)) return 2;
        if (ts.isNamespaceExportDeclaration(declaration)) return 3;
        if (ts.isClassDeclaration(declaration)) return 5;
        if (
            ts.isMethodDeclaration(declaration) ||
            ts.isConstructSignatureDeclaration(declaration) ||
            ts.isGetAccessorDeclaration(declaration) ||
            ts.isSetAccessorDeclaration(declaration)
        )
            return 6;
        if (ts.isPropertyDeclaration(declaration)) return 7;
        if (ts.isConstructorDeclaration(declaration)) return 9;
        if (ts.isEnumDeclaration(declaration)) return 10;
        if (ts.isInterfaceDeclaration(declaration)) return 11;
        if (ts.isFunctionDeclaration(declaration)) return 12;
        if (ts.isVariableDeclaration(declaration)) return 13;
        if (ts.isTypeParameterDeclaration(declaration)) return 26;
        return 0;
    }

    private emitDeclaration(
        node:
            | ts.ClassDeclaration
            | ts.EnumDeclaration
            | ts.FunctionDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeParameterDeclaration
            | ts.PropertyDeclaration
            | ts.MethodDeclaration
            | ts.ConstructSignatureDeclaration
            | ts.GetAccessorDeclaration
            | ts.SetAccessorDeclaration
            | ts.PropertyDeclaration
            | ts.ConstructorDeclaration
            | ts.VariableDeclaration,
        lsifSymbol: LsifSymbol
    ) {
        this.writeIndex(new ResultSet({ id: this.lsifCounter.next(), type: 'vertex', label: 'resultSet' }));
        this.writeIndex(new Moniker({ id: this.lsifCounter.next(), type: 'vertex', label: 'moniker' }));

        const id = this.lsifCounter.next();
        const rangeLsif = Range.fromNode(node);

        const start = new Position({
            line: rangeLsif.start.line,
            character: rangeLsif.start.character,
        });
        const end = new Position({
            line: rangeLsif.end.line,
            character: rangeLsif.end.character,
        });
        let lsifRange = new LsifRange({
            id,
            type: 'vertex',
            label: 'range',
            start,
            end,
            tag: new LsifRange.Tag({
                text: lsifSymbol.value,
                kind: this.getDeclarationKind(node),
                fullRange: new FullRange({ start, end }),
            }),
        });
        this.definitions.set(id, new DefinitionRange(this.sourceFile.fileName, rangeLsif));
        this.writeIndex(lsifRange);
        return id;
    }

    private getAndStoreReferences(
        id: number,
        node:
            | ts.ClassDeclaration
            | ts.EnumDeclaration
            | ts.FunctionDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeParameterDeclaration
            | ts.PropertyDeclaration
            | ts.MethodDeclaration
            | ts.ConstructSignatureDeclaration
            | ts.GetAccessorDeclaration
            | ts.SetAccessorDeclaration
            | ts.PropertyDeclaration
            | ts.ConstructorDeclaration
            | ts.VariableDeclaration
    ) {
        const foundReferences = this.languageService.findReferences(this.sourceFile.fileName, node.name!.getStart());
        if (!this.references.has(id)) this.references.set(id, new Array<DefinitionRange>());
        if (foundReferences) {
            foundReferences.forEach((foundReference) => {
                let referencesRangeArray = foundReference.references.map((reference) => {
                    return new DefinitionRange(
                        reference.fileName,
                        Range.fromTextSpan(this.sourceFile, reference.textSpan)
                    );
                });
                this.references.get(id)!.push(...referencesRangeArray);
            });
        }
    }

    private visitDeclaration(node: ts.Node): number {
        let id = this.lsifCounter.get();
        let lsifSymbol = this.lsifSymbol(node);

        if (
            ts.isClassDeclaration(node) ||
            ts.isEnumDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeParameterDeclaration(node)
        ) {
            if (node.name === undefined) return id;
            id = this.emitDeclaration(node, lsifSymbol);
            this.getAndStoreReferences(id, node);
        }

        if (
            ts.isPropertyDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isConstructorDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node) ||
            ts.isConstructSignatureDeclaration(node) //||
            // ts.isVariableDeclaration(node)
        ) {
            if (node.name === undefined) return id;
            id = this.emitDeclaration(node, lsifSymbol);
            this.getAndStoreReferences(id, node);
        }

        return id;
    }

    private lsifSymbol(node: ts.Node): LsifSymbol {
        const fromCache: LsifSymbol | undefined = this.globalSymbolTable.get(node) || this.localSymbolTable.get(node);
        if (fromCache) {
            return fromCache;
        }
        if (ts.isBlock(node)) {
            return LsifSymbol.empty();
        }
        if (ts.isSourceFile(node)) {
            const package_ = this.packages.symbol(node.fileName);
            if (!package_) {
                return this.cached(node, LsifSymbol.empty());
            }
            return this.cached(node, package_);
        }
        if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
            const name = node.name.getText();
            let counter = this.propertyCounters.get(name);
            if (!counter) {
                counter = new Counter();
                this.propertyCounters.set(name, counter);
            }
            return this.cached(
                node,
                LsifSymbol.global(
                    this.lsifSymbol(node.getSourceFile()),
                    metaDescriptor(`${node.name.getText()}${counter.next()}`)
                )
            );
        }

        if (ts.isJsxAttribute(node)) {
            // NOTE(olafurpg): the logic below is a bit convoluted but I spent several
            // hours and failed to come up with a cleaner solution. JSX attributes
            // have custom typechecking rules, as documented here
            // https://www.typescriptlang.org/docs/handbook/jsx.html#type-checking The
            // only way to access the actual symbol we want to reference appears to go
            // through the JSX opening element, which is the grandparent of the JSX
            // attribute node. Through the signature of the opening element, we get
            // the permitted attributes by querying the type of the first parameter.
            const jsxElement = node.parent.parent;
            const props = this.checker.getResolvedSignature(jsxElement)?.getParameters()?.[0];
            if (props) {
                try {
                    const tpe = this.checker.getTypeOfSymbolAtLocation(props, node);
                    const property = tpe.getProperty(node.name.text);
                    for (const decl of property?.declarations || []) {
                        return this.lsifSymbol(decl);
                    }
                } catch {
                    // TODO: https://github.com/sourcegraph/lsif-typescript/issues/34
                    // continue regardless of error, the TypeScript compiler tends to
                    // trigger stack overflows in getTypeOfSymbolAtLocation and we
                    // don't know why yet.
                }
            }
        }

        const owner = this.lsifSymbol(node.parent);
        if (owner.isEmpty() || owner.isLocal()) {
            return this.newLocalSymbol(node);
        }

        if (isAnonymousContainerOfSymbols(node)) {
            return this.cached(node, this.lsifSymbol(node.parent));
        }

        if (ts.isImportSpecifier(node) || ts.isImportClause(node)) {
            const tpe = this.checker.getTypeAtLocation(node);
            for (const declaration of tpe.symbol?.declarations || []) {
                return this.lsifSymbol(declaration);
            }
        }

        const desc = this.descriptor(node);
        if (desc) {
            return this.cached(node, LsifSymbol.global(owner, desc));
        }

        // Fallback case: generate a local symbol. It's not a bug when this case
        // happens. For example, we hit this case for block `{}` that are local
        // symbols, which are direct children of global symbols (toplevel
        // functions).
        return this.newLocalSymbol(node);
    }

    private newLocalSymbol(node: ts.Node): LsifSymbol {
        const symbol = LsifSymbol.local(this.localCounter.next());
        this.localSymbolTable.set(node, symbol);
        return symbol;
    }
    private cached(node: ts.Node, symbol: LsifSymbol): LsifSymbol {
        this.globalSymbolTable.set(node, symbol);
        return symbol;
    }
    private descriptor(node: ts.Node): Descriptor | undefined {
        if (ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
            return typeDescriptor(node.name.getText());
        }
        if (ts.isClassLike(node)) {
            const name = node.name?.getText();
            if (name) {
                return typeDescriptor(name);
            }
        }
        if (ts.isFunctionDeclaration(node) || ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) {
            const name = node.name?.getText();
            if (name) {
                return methodDescriptor(name);
            }
        }
        if (ts.isConstructorDeclaration(node)) {
            return methodDescriptor('<constructor>');
        }
        if (
            ts.isPropertyDeclaration(node) ||
            ts.isPropertySignature(node) ||
            ts.isEnumMember(node) ||
            ts.isVariableDeclaration(node)
        ) {
            return termDescriptor(node.name.getText());
        }
        if (ts.isAccessor(node)) {
            const prefix = ts.isGetAccessor(node) ? '<get>' : '<set>';
            return methodDescriptor(prefix + node.name.getText());
        }
        if (ts.isModuleDeclaration(node)) {
            return packageDescriptor(node.name.getText());
        }
        if (ts.isParameter(node)) {
            return parameterDescriptor(node.name.getText());
        }
        if (ts.isTypeParameterDeclaration(node)) {
            return typeParameterDescriptor(node.name.getText());
        }
        return undefined;
    }
}

function isAnonymousContainerOfSymbols(node: ts.Node): boolean {
    return (
        ts.isModuleBlock(node) ||
        ts.isImportDeclaration(node) ||
        (ts.isImportClause(node) && !node.name) ||
        ts.isNamedImports(node) ||
        ts.isVariableStatement(node) ||
        ts.isVariableDeclarationList(node)
    );
}
