import { Console } from 'console';
import * as ts from 'typescript';
import * as Sentry from '@sentry/node';
import { is } from 'uvu/assert';
import { Complexity } from './Complexity';

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
import { keywordStrings, keywordToStringMap, operatorTokenToStringMap } from './ToStringMaps';

type Descriptor = lsif.lib.codeintel.lsiftyped.Descriptor;

export class FileIndexer {
    private localCounter = new Counter();
    private propertyCounters: Map<string, Counter> = new Map();
    private localSymbolTable: Map<ts.Node, LsifSymbol> = new Map();
    private parentChildRelationships: ParentChildRelationships[] = Array<ParentChildRelationships>();
    // Since a file is a module, we don't want to start randomly in the parentChildRelationships array.
    // We want to aggregate parents from the "file"/module-level.
    private parentChildRelationshipsModuleLevel: ParentChildRelationships[] = Array<ParentChildRelationships>();
    public currentComponentHeirarchy: Complexity[] = new Array<Complexity>();
    private currentComponentHeirarchyPositions: number[] = Array<number>();
    private indentLevel = 0;

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
        public readonly languageService: ts.LanguageService,
        public readonly dev: boolean,
        public readonly underTest: boolean = false
    ) {}
    public index(): void {
        this.visit(this.sourceFile);
        this.emitDocumentSymbolResults();
    }

    private indent(): string {
        return '\t'.repeat(this.indentLevel);
    }

    private emitDocumentSymbolResults() {
        for (let parentChildRelationshipModuleLevel of this.parentChildRelationshipsModuleLevel) {
            if (parentChildRelationshipModuleLevel.children.length == 0) continue;
            this.writeIndex(parentChildRelationshipModuleLevel.getEmittable(this.lsifCounter.next()));
        }
    }

    private pushComponentToHeirarchy(id: number, isSourceFile: boolean = false) {
        this.indentLevel += 1;
        if (!isSourceFile) {
            let parentChildRelationship = new ParentChildRelationships(id, this.parentChildRelationships.length == 0);
            this.parentChildRelationships.push(parentChildRelationship);
        }
        this.currentComponentHeirarchy.push(new Complexity(id));
        this.currentComponentHeirarchyPositions.push(0);
        this.currentComponentHeirarchyPositions = this.currentComponentHeirarchyPositions.map((element) => element - 1);
    }

    private popComponentFromHeirarchy(node: ts.Node) {
        this.indentLevel -= 1;
        let finalElementPosition = this.currentComponentHeirarchyPositions.pop();
        if (this.underTest) return;
        let currentComplexityNode = this.currentComponentHeirarchy.pop();

        if (this.dev) console.log('currentComplexityNode', currentComplexityNode);

        if (currentComplexityNode) {
            this.writeIndex(currentComplexityNode.getEmittable(this.lsifCounter.next()));
        }
        let child = this.parentChildRelationships.pop();
        if (child === undefined) return;
        if (this.parentChildRelationships.length == 0) {
            this.parentChildRelationshipsModuleLevel.push(child);
            return;
        }
        this.parentChildRelationships[this.parentChildRelationships.length - 1].children.push(child);
        this.currentComponentHeirarchyPositions = this.currentComponentHeirarchyPositions.map((element) => element + 1);
    }

    private visit(node: ts.Node): void {
        if (this.dev) console.log(`${this.indent()}• visit [${node.pos}:${node.end}]`);
        if (!this.continueWalk(node)) return;

        if (this.dev) console.log('visit...');

        ts.forEachChild(node, (node) => {
            if (this.dev) console.log(`${this.indent()}• visit.child [${node.pos}:${node.end}]`);
            this.visit(node);
        });
    }

    private continueWalk(node: ts.Node): boolean {
        if (this.dev) console.log('continueWalk', node.kind);

        if (ts.isSourceFile(node)) return this.visitSourceFile(node);

        if (ts.isImportDeclaration(node)) return this.visitImportDeclaration(node);
        if (ts.isNamedImports(node)) return this.visitNamedImports(node);
        if (ts.isNamespaceImport(node)) return this.visitNamespaceImport(node);
        if (ts.isAsteriskToken(node)) return this.visitAsteriskToken(node);
        if (keywordToStringMap.has(node.kind)) return this.visitKeyword(node.kind);
        if (operatorTokenToStringMap.has(node.kind)) return this.visitOperator(node.kind);
        if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) return this.visitNumericLiteral(node);
        if (ts.isStringLiteral(node)) return this.visitStringLiteral(node);
        if (ts.isBlock(node)) return this.visitBlock(node);
        if (ts.isClassStaticBlockDeclaration(node)) return this.visitClassStaticBlockDeclaration(node);
        if (ts.isParameter(node)) return this.visitParameter(node);
        if (ts.isCallExpression(node)) return this.visitCallExpression(node);
        if (ts.isIdentifier(node)) return this.visitIdentifier(node);
        if (ts.isBinaryExpression(node)) return this.visitBinaryExpression(node);
        if (ts.isIfStatement(node)) return this.visitIfStatement(node);
        if (node.kind === ts.SyntaxKind.SyntaxList) return this.visitSyntaxList(<ts.SyntaxList>(<unknown>node));
        if (ts.isExpressionStatement(node)) return this.visitExpressionStatement(node);
        if (ts.isClassDeclaration(node)) return this.visitClassDeclaration(node);
        if (ts.isMethodDeclaration(node)) return this.visitMethodDeclaration(node);
        if (ts.isFunctionDeclaration(node)) return this.visitFunctionDeclaration(node);
        if (ts.isFunctionExpression(node)) return this.visitFunctionExpression(node);
        if (ts.isPropertyDeclaration(node)) return this.visitPropertyDeclaration(node);
        if (ts.isArrayTypeNode(node)) return this.visitArrayTypeNode(node);
        if (ts.isReturnStatement(node)) return this.visitReturnStatement(node);
        if (ts.isPropertyAccessExpression(node)) return this.visitPropertyAccessExpression(node);
        if (ts.isTypeReferenceNode(node)) return this.visitTypeReferenceNode(node);
        if (ts.isVariableStatement(node)) return this.visitVariableStatement(node);
        if (ts.isVariableDeclarationList(node)) return this.visitVariableDeclarationList(node);
        if (ts.isVariableDeclaration(node)) return this.visitVariableDeclaration(node);
        if (ts.isArrowFunction(node)) return this.visitArrowFunction(node);
        if (ts.isConstructorDeclaration(node)) return this.visitConstructorDeclaration(node);
        if (ts.isInterfaceDeclaration(node)) return this.visitInterfaceDeclaration(node);
        if (ts.isMethodSignature(node)) return this.visitMethodSignature(node);
        if (ts.isTypeParameterDeclaration(node)) return this.visitTypeParameterDeclaration(node);
        if (ts.isHeritageClause(node)) return this.visitHeritageClause(node);
        if (ts.isExpressionWithTypeArguments(node)) return this.visitExpressionWithTypeArguments(node);
        if (ts.isNewExpression(node)) return this.visitNewExpression(node);
        if (ts.isTypeAliasDeclaration(node)) return this.visitTypeAliasDeclaration(node);
        if (ts.isTypeLiteralNode(node)) return this.visitTypeLiteralNode(node);
        if (ts.isPropertySignature(node)) return this.visitPropertySignature(node);
        if (ts.isComputedPropertyName(node)) return this.visitComputedPropertyName(node);
        if (ts.isExportAssignment(node)) return this.visitExportAssignment(node);
        if (ts.isModuleDeclaration(node)) return this.visitModuleDeclaration(node);
        if (ts.isModuleBlock(node)) return this.visitModuleBlock(node);
        if (ts.isSetAccessorDeclaration(node)) return this.visitSetAccesssorDeclaration(node);
        if (ts.isGetAccessorDeclaration(node)) return this.visitGetAccessorDeclaration(node);
        if (ts.isSetAccessor(node)) return this.visitSetAccesssor(node);
        if (ts.isConstructSignatureDeclaration(node)) return this.visitConstructSignatureDeclaration(node);
        if (ts.isFunctionTypeNode(node)) return this.visitFunctionTypeNode(node);
        if (ts.isForStatement(node)) return this.visitForStatement(node);
        if (ts.isExportDeclaration(node)) return this.visitExportDeclaration(node);
        if (ts.isPrefixUnaryExpression(node)) return this.visitPrefixUnaryExpression(node);
        if (ts.isBreakStatement(node)) return this.visitBreakStatement(node);
        if (ts.isContinueStatement(node)) return this.visitContinueStatement(node);
        if (ts.isParenthesizedExpression(node)) return this.visitParenthesizedExpression(node);
        if (ts.isUnionTypeNode(node)) return this.visitUnionTypeNode(node);
        if (ts.isTypeQueryNode(node)) return this.visitTypeQueryNode(node);
        if (ts.isArrayLiteralExpression(node)) return this.visitArrayLiteralExpression(node);
        if (ts.isObjectBindingPattern(node)) return this.visitObjectBindingPattern(node);
        if (ts.isBindingElement(node)) return this.visitBindingElement(node);
        if (ts.isObjectLiteralExpression(node)) return this.visitObjectLiteralExpression(node);
        if (ts.isShorthandPropertyAssignment(node)) return this.visitShorthandPropertyAssignment(node);
        if (ts.isPropertyAssignment(node)) return this.visitPropertyAssignment(node);
        if (ts.isImportEqualsDeclaration(node)) return this.visitImportEqualsDeclaration(node);
        if (ts.isQualifiedName(node)) return this.visitQualifiedName(node);
        if (ts.isPrivateIdentifier(node)) return this.visitPrivateIdentifier(node);
        if (ts.isCallSignatureDeclaration(node)) return this.visitCallSignatureDeclaration(node);
        if (ts.isAwaitExpression(node)) return this.visitAwaitExpression(node);
        if (ts.isPostfixUnaryExpression(node)) return this.visitPostfixUnaryExpression(node);

        if (ts.isJsxText(node)) return this.visitJsxText(node);

        if (ts.isRegularExpressionLiteral(node)) return this.visitRegularExpressionLiteral(node);
        if (ts.isNoSubstitutionTemplateLiteral(node)) return this.visitNoSubstitutionTemplateLiteral(node);
        if (ts.isTemplateHead(node)) return this.visitTemplateHead(node);
        if (ts.isTemplateMiddle(node)) return this.visitTemplateMiddle(node);
        if (ts.isTemplateTail(node)) return this.visitTemplateTail(node);
        if (ts.isDotDotDotToken(node)) return this.visitDotDotDotToken(node);
        if (ts.isPlusToken(node)) return this.visitPlusToken(node);
        if (ts.isMinusToken(node)) return this.visitMinusToken(node);
        if (ts.isDecorator(node)) return this.visitDecorator(node);
        if (ts.isIndexSignatureDeclaration(node)) return this.visitIndexSignatureDeclaration(node);
        if (ts.isTypePredicateNode(node)) return this.visitTypePredicateNode(node);
        if (ts.isConstructorTypeNode(node)) return this.visitConstructorTypeNode(node);
        if (ts.isTupleTypeNode(node)) return this.visitTupleTypeNode(node);
        if (ts.isOptionalTypeNode(node)) return this.visitOptionalTypeNode(node);
        if (ts.isRestTypeNode(node)) return this.visitRestTypeNode(node);
        if (ts.isIntersectionTypeNode(node)) return this.visitIntersectionTypeNode(node);
        if (ts.isConditionalTypeNode(node)) return this.visitConditionalTypeNode(node);
        if (ts.isInferTypeNode(node)) return this.visitInferTypeNode(node);
        if (ts.isParenthesizedTypeNode(node)) return this.visitParenthesizedTypeNode(node);
        if (ts.isThisTypeNode(node)) return this.visitThisTypeNode(node);
        if (ts.isTypeOperatorNode(node)) return this.visitTypeOperatorNode(node);
        if (ts.isIndexedAccessTypeNode(node)) return this.visitIndexedAccessTypeNode(node);
        if (ts.isMappedTypeNode(node)) return this.visitMappedTypeNode(node);
        if (ts.isLiteralTypeNode(node)) return this.visitLiteralTypeNode(node);
        if (ts.isImportTypeNode(node)) return this.visitImportTypeNode(node);
        if (ts.isTemplateLiteralTypeSpan(node)) return this.visitTemplateLiteralTypeSpan(node);
        if (ts.isTemplateLiteralTypeNode(node)) return this.visitTemplateLiteralTypeNode(node);
        if (ts.isArrayBindingPattern(node)) return this.visitArrayBindingPattern(node);
        if (ts.isElementAccessExpression(node)) return this.visitElementAccessExpression(node);
        if (ts.isTaggedTemplateExpression(node)) return this.visitTaggedTemplateExpression(node);
        if (ts.isTypeAssertionExpression(node)) return this.visitTypeAssertionExpression(node);
        if (ts.isDeleteExpression(node)) return this.visitDeleteExpression(node);
        if (ts.isTypeOfExpression(node)) return this.visitTypeOfExpression(node);
        if (ts.isVoidExpression(node)) return this.visitVoidExpression(node);
        if (ts.isConditionalExpression(node)) return this.visitConditionalExpression(node);
        if (ts.isTemplateExpression(node)) return this.visitTemplateExpression(node);
        if (ts.isYieldExpression(node)) return this.visitYieldExpression(node);
        if (ts.isSpreadElement(node)) return this.visitSpreadElement(node);
        if (ts.isClassExpression(node)) return this.visitClassExpression(node);
        if (ts.isOmittedExpression(node)) return this.visitOmittedExpression(node);
        if (ts.isAsExpression(node)) return this.visitAsExpression(node);
        if (ts.isNonNullExpression(node)) return this.visitNonNullExpression(node);
        if (ts.isMetaProperty(node)) return this.visitMetaProperty(node);
        if (ts.isSyntheticExpression(node)) return this.visitSyntheticExpression(node);
        if (ts.isPartiallyEmittedExpression(node)) return this.visitPartiallyEmittedExpression(node);
        if (ts.isCommaListExpression(node)) return this.visitCommaListExpression(node);
        if (ts.isTemplateSpan(node)) return this.visitTemplateSpan(node);
        if (ts.isSemicolonClassElement(node)) return this.visitSemicolonClassElement(node);
        if (ts.isEmptyStatement(node)) return this.visitEmptyStatement(node);
        if (ts.isDoStatement(node)) return this.visitDoStatement(node);
        if (ts.isWhileStatement(node)) return this.visitWhileStatement(node);
        if (ts.isForInStatement(node)) return this.visitForInForOfStatement(node, 'in');
        if (ts.isForOfStatement(node)) return this.visitForInForOfStatement(node, 'of');
        if (ts.isWithStatement(node)) return this.visitWithStatement(node);
        if (ts.isSwitchStatement(node)) return this.visitSwitchStatement(node);
        if (ts.isLabeledStatement(node)) return this.visitLabeledStatement(node);
        if (ts.isThrowStatement(node)) return this.visitThrowStatement(node);
        if (ts.isTryStatement(node)) return this.visitTryStatement(node);
        if (ts.isDebuggerStatement(node)) return this.visitDebuggerStatement(node);
        if (ts.isEnumDeclaration(node)) return this.visitEnumDeclaration(node);
        if (ts.isCaseBlock(node)) return this.visitCaseBlock(node);
        if (ts.isNamespaceExportDeclaration(node)) return this.visitNamespaceExportDeclaration(node);
        if (ts.isImportClause(node)) return this.visitImportClause(node);
        if (ts.isImportTypeAssertionContainer(node)) return this.visitImportTypeAssertionContainer(node);
        if (ts.isAssertClause(node)) return this.visitAssertClause(node);
        if (ts.isAssertEntry(node)) return this.visitAssertEntry(node);
        if (ts.isNamespaceExport(node)) return this.visitNamespaceExport(node);
        if (ts.isImportSpecifier(node)) return this.visitImportSpecifier(node);
        if (ts.isNamedExports(node)) return this.visitNamedExports(node);
        if (ts.isExportSpecifier(node)) return this.visitExportSpecifier(node);
        if (ts.isMissingDeclaration(node)) return this.visitMissingDeclaration(node);
        if (ts.isNotEmittedStatement(node)) return this.visitNotEmittedStatement(node);
        if (ts.isExternalModuleReference(node)) return this.visitExternalModuleReference(node);

        if (ts.isJsxElement(node)) return this.visitJsxElement(node);
        if (ts.isJsxSelfClosingElement(node)) return this.visitJsxSelfClosingElement(node);
        if (ts.isJsxOpeningElement(node)) return this.visitJsxOpeningElement(node);
        if (ts.isJsxClosingElement(node)) return this.visitJsxClosingElement(node);
        if (ts.isJsxFragment(node)) return this.visitJsxFragment(node);
        if (ts.isJsxOpeningFragment(node)) return this.visitJsxOpeningFragment(node);
        if (ts.isJsxClosingFragment(node)) return this.visitJsxClosingFragment(node);
        if (ts.isJsxAttribute(node)) return this.visitJsxAttribute(node);
        if (ts.isJsxAttributes(node)) return this.visitJsxAttributes(node);
        if (ts.isJsxSpreadAttribute(node)) return this.visitJsxSpreadAttribute(node);
        if (ts.isJsxExpression(node)) return this.visitJsxExpression(node);

        if (ts.isCaseClause(node)) return this.visitCaseClause(node);
        if (ts.isDefaultClause(node)) return this.visitDefaultClause(node);
        if (ts.isCatchClause(node)) return this.visitCatchClause(node);
        if (ts.isSpreadAssignment(node)) return this.visitSpreadAssignment(node);
        if (ts.isEnumMember(node)) return this.visitEnumMember(node);
        if (ts.isUnparsedPrepend(node)) return this.visitUnparsedPrepend(node);
        if (ts.isBundle(node)) return this.visitBundle(node);

        if (ts.isUnparsedSource(node)) return this.visitUnparsedSource(node);

        if (ts.isJSDocTypeExpression(node)) return this.visitJSDocTypeExpression(node);
        if (ts.isJSDocNameReference(node)) return this.visitJSDocNameReference(node);
        if (ts.isJSDocMemberName(node)) return this.visitJSDocMemberName(node);
        if (ts.isJSDocLink(node)) return this.visitJSDocLink(node);
        if (ts.isJSDocLinkCode(node)) return this.visitJSDocLinkCode(node);
        if (ts.isJSDocLinkPlain(node)) return this.visitJSDocLinkPlain(node);
        if (ts.isJSDocAllType(node)) return this.visitJSDocAllType(node);
        if (ts.isJSDocUnknownType(node)) return this.visitJSDocUnknownType(node);
        if (ts.isJSDocNullableType(node)) return this.visitJSDocNullableType(node);
        if (ts.isJSDocNonNullableType(node)) return this.visitJSDocNonNullableType(node);
        if (ts.isJSDocOptionalType(node)) return this.visitJSDocOptionalType(node);
        if (ts.isJSDocFunctionType(node)) return this.visitJSDocFunctionType(node);
        if (ts.isJSDocVariadicType(node)) return this.visitJSDocVariadicType(node);
        if (ts.isJSDocNamepathType(node)) return this.visitJSDocNamepathType(node);
        if (ts.isJSDoc(node)) return this.visitJSDoc(node);
        if (ts.isJSDocTypeLiteral(node)) return this.visitJSDocTypeLiteral(node);
        if (ts.isJSDocSignature(node)) return this.visitJSDocSignature(node);
        if (ts.isJSDocAugmentsTag(node)) return this.visitJSDocAugmentsTag(node);
        if (ts.isJSDocAuthorTag(node)) return this.visitJSDocAuthorTag(node);
        if (ts.isJSDocClassTag(node)) return this.visitJSDocClassTag(node);
        if (ts.isJSDocCallbackTag(node)) return this.visitJSDocCallbackTag(node);
        if (ts.isJSDocPublicTag(node)) return this.visitJSDocPublicTag(node);
        if (ts.isJSDocPrivateTag(node)) return this.visitJSDocPrivateTag(node);
        if (ts.isJSDocProtectedTag(node)) return this.visitJSDocProtectedTag(node);
        if (ts.isJSDocReadonlyTag(node)) return this.visitJSDocReadonlyTag(node);
        if (ts.isJSDocOverrideTag(node)) return this.visitJSDocOverrideTag(node);
        if (ts.isJSDocDeprecatedTag(node)) return this.visitJSDocDeprecatedTag(node);
        if (ts.isJSDocSeeTag(node)) return this.visitJSDocSeeTag(node);
        if (ts.isJSDocEnumTag(node)) return this.visitJSDocEnumTag(node);
        if (ts.isJSDocParameterTag(node)) return this.visitJSDocParameterTag(node);
        if (ts.isJSDocReturnTag(node)) return this.visitJSDocReturnTag(node);
        if (ts.isJSDocThisTag(node)) return this.visitJSDocThisTag(node);
        if (ts.isJSDocTypeTag(node)) return this.visitJSDocTypeTag(node);
        if (ts.isJSDocTemplateTag(node)) return this.visitJSDocTemplateTag(node);
        if (ts.isJSDocTypedefTag(node)) return this.visitJSDocTypedefTag(node);
        if (ts.isJSDocUnknownTag(node)) return this.visitJSDocUnknownTag(node);
        if (ts.isJSDocPropertyTag(node)) return this.visitJSDocPropertyTag(node);
        if (ts.isJSDocImplementsTag(node)) return this.visitJSDocImplementsTag(node);

        return true;
    }

    private visitSourceFile(node: ts.SourceFile) {
        if (this.dev) console.log(`**FILE** -->${node.fileName}`);
        if (this.dev) console.log(`${this.indent()}• visitSourceFile [${node.pos}:${node.end}]`);
        this.pushComponentToHeirarchy(this.lsifCounter.get());
        this.visitBlockStatements(node.statements);
        return false;
    }

    private visitImportDeclaration(node: ts.ImportDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitImportDeclaration [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['import']);
        if (node.importClause) {
            this.continueWalk(node.importClause);
            this.addOperatorsToAllHalstead(['from']);
        }
        this.continueWalk(node.moduleSpecifier);
        if (node.assertClause) {
            this.continueWalk(node.assertClause);
        }
        if (this.dev) console.log(`${this.indent()}• visitImportDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitNamespaceImport(node: ts.NamespaceImport): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNamespaceImport [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['*', 'as']);
        this.continueWalk(node.name);
        if (this.dev) console.log(`${this.indent()}• visitNamespaceImport [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitNamedImports(node: ts.NamedImports): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNamedImports [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements);
        if (this.dev) console.log(`${this.indent()}• visitNamedImports [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitAsteriskToken(node: ts.AsteriskToken): boolean {
        if (this.dev) console.log(`${this.indent()}• visitAsteriskToken [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['*']);
        if (this.dev) console.log(`${this.indent()}• visitAsteriskToken [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitKeyword(kind: ts.SyntaxKind): boolean {
        if (this.dev) console.log(`${this.indent()}• visitKeyword`);
        let keywordString = keywordToStringMap.get(kind);
        if (keywordString) {
            this.addOperatorsToAllHalstead([keywordString]);
        }
        if (this.dev) console.log(`${this.indent()}• visitKeyword <<EXIT>>`);
        return false;
    }

    private visitOperator(kind: ts.SyntaxKind): boolean {
        if (this.dev) console.log(`${this.indent()}• visitOperator`, kind);
        let operatorString = operatorTokenToStringMap.get(kind);
        if (operatorString) {
            this.addOperatorsToAllHalstead([operatorString]);
        }
        if (this.dev) console.log(`${this.indent()}• visitOperator <<EXIT>>`);
        return false;
    }

    private visitNumericLiteral(node: ts.NumericLiteral | ts.BigIntLiteral): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNumericLiteral [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([node.text]);
        if (this.dev) console.log(`${this.indent()}• visitNumericLiteral [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitStringLiteral(node: ts.StringLiteral) {
        if (this.dev) console.log(`${this.indent()}• visitStringLiteral [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([`"${node.text}"`]);
        if (this.dev) console.log(`${this.indent()}• visitStringLiteral [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitBlock(node: ts.Block): boolean {
        if (this.dev) console.log(`${this.indent()}• visitBlock [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['{}']);
        node.statements.forEach((child) => {
            if (this.dev) console.log(`${this.indent()}• visitBlock [${node.pos}:${node.end}], node.child`, child);
            this.continueWalk(child);
        });
        if (this.dev) console.log(`${this.indent()}• visitBlock [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitClassStaticBlockDeclaration(node: ts.ClassStaticBlockDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitClassStaticBlockDeclaration [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['static']);
        this.continueWalk(node.body);
        return false;
    }

    private visitParameter(node: ts.ParameterDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitParameter [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        if (node.dotDotDotToken) {
            this.addOperatorsToAllHalstead(['...']);
        }
        if (node.name) this.continueWalk(node.name);
        if (node.questionToken) {
            this.addOperatorsToAllHalstead(['?']);
        }
        if (node.type) {
            this.addOperatorsToAllHalstead([':']);
            this.continueWalk(node.type);
        }
        if (node.initializer) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.initializer);
        }
        if (this.dev) console.log(`${this.indent()}• visitParameter [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitArrayTypeNode(node: ts.ArrayTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitArrayTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.elementType);
        this.addOperatorsToAllHalstead(['[]']);
        if (this.dev) console.log(`${this.indent()}• visitArrayTypeNode [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitCallExpression(node: ts.CallExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitCallExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.expression);
        this.visitNodeArray(node.arguments, '()');
        if (this.dev) console.log(`${this.indent()}• visitCallExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitBinaryExpression(node: ts.BinaryExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitBinaryExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.left);
        this.continueWalk(node.operatorToken);
        this.continueWalk(node.right);
        if (this.dev) console.log(`${this.indent()}• visitBinaryExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitIdentifier(node: ts.Identifier) {
        if (this.dev) console.log(`${this.indent()}• visitIdentifier [${node.pos}:${node.end}]`);
        let identifier = node.escapedText.toString();
        if (this.dev) console.log(`${this.indent()}• visitIdentifier [${node.pos}:${node.end}]`, identifier);

        if (keywordStrings.indexOf(identifier) > -1) {
            this.addOperatorsToAllHalstead([identifier]);
            return false;
        }
        this.addOperandsToAllHalstead([identifier]);
        if (this.dev) console.log(`${this.indent()}• visitIdentifier [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitIfStatement(node: ts.IfStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitIfStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['if', '()']);
        this.continueWalk(node.expression);
        this.continueWalk(node.thenStatement);
        if (node.elseStatement) {
            this.addOperatorsToAllHalstead(['else']);
            this.continueWalk(node.elseStatement);
        }
        if (this.dev) console.log(`${this.indent()}• visitIfStatement [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitForStatement(node: ts.ForStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitForStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['for', '()']);
        if (node.initializer) this.continueWalk(node.initializer);
        this.addOperatorsToAllHalstead([';']);
        if (node.condition) this.continueWalk(node.condition);
        this.addOperatorsToAllHalstead([';']);
        if (node.incrementor) this.continueWalk(node.incrementor);
        this.continueWalk(node.statement);
        if (this.dev) console.log(`${this.indent()}• visitForStatement [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitPrefixUnaryExpression(node: ts.PrefixUnaryExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPrefixUnaryExpression [${node.pos}:${node.end}]`);
        this.visitOperator(node.operator);
        this.continueWalk(node.operand);
        if (this.dev) console.log(`${this.indent()}• visitPrefixUnaryExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitPostfixUnaryExpression(node: ts.PostfixUnaryExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPostfixUnaryExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.operand);
        this.visitOperator(node.operator);
        if (this.dev) console.log(`${this.indent()}• visitPostfixUnaryExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitSyntaxList(node: ts.SyntaxList): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSyntaxList [${node.pos}:${node.end}]`);
        node.getChildren().forEach((child) => {
            this.continueWalk(child);
        });
        if (this.dev) console.log(`${this.indent()}• visitSyntaxList [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitExpressionStatement(node: ts.ExpressionStatement): boolean {
        if (this.dev)
            console.log(
                `${this.indent()}• visitExpressionStatement [${node.pos}:${node.end}], node.expression`,
                node.expression
            );
        this.continueWalk(node.expression);
        if (this.dev) console.log(`${this.indent()}• visitExpressionStatement [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitReturnStatement(node: ts.ReturnStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitReturnStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['return']);
        if (node.expression) return this.continueWalk(node.expression);
        if (this.dev) console.log(`${this.indent()}• visitReturnStatement [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitPropertyAccessExpression(node: ts.PropertyAccessExpression): boolean {
        if (this.dev)
            console.log(
                `${this.indent()}• visitPropertyAccessExpression - ${node.expression}.${node.name.escapedText} - [${
                    node.pos
                }:${node.end}]`,
                node
            );
        this.continueWalk(node.expression);
        if (node.questionDotToken) this.addOperatorsToAllHalstead(['?']);
        this.addOperatorsToAllHalstead(['.']);
        this.continueWalk(node.name);
        if (this.dev) console.log(`${this.indent()}• visitPropertyAccessExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitComputedPropertyName(node: ts.ComputedPropertyName): boolean {
        if (this.dev) console.log(`${this.indent()}• visitComputedPropertyName [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['[]']);
        this.continueWalk(node.expression);
        return false;
    }

    private visitTypeParameterDeclaration(node: ts.TypeParameterDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeParameterDeclaration [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        if (node.constraint) {
            this.addOperatorsToAllHalstead(['[]']);
            this.continueWalk(node.name);
            this.addOperatorsToAllHalstead(['in']);
            this.continueWalk(node.constraint);
            return false;
        }
        if (node.default) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.default);
        }
        if (node.expression) throw new Error('************************ URGENT & NEW, node.expression');
        this.continueWalk(node.name);
        if (this.dev) console.log(`${this.indent()}• visitTypeParameterDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitTypeReferenceNode(node: ts.TypeReferenceNode) {
        if (this.dev) console.log(`${this.indent()}• visitTypeReferenceNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.typeName);
        if (node.typeArguments) {
            this.addOperatorsToAllHalstead(['<>']);
            this.visitNodeArray(node.typeArguments, '', ',', false);
        }
        if (this.dev) console.log(`${this.indent()}• visitTypeReferenceNode [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitVariableStatement(node: ts.VariableStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitVariableStatement [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        this.continueWalk(node.declarationList);
        if (this.dev) console.log(`${this.indent()}• visitVariableStatement [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitVariableDeclarationList(node: ts.VariableDeclarationList): boolean {
        if (this.dev) console.log(`${this.indent()}• visitVariableDeclarationList [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));

        // TODO - investigate https://github.com/source-field/sourcefield-lsif-typescript/pull/1#discussion_r977227847
        if (node.flags == ts.NodeFlags.None || node.flags & ts.NodeFlags.None) this.addOperatorsToAllHalstead(['var']);
        if (node.flags == ts.NodeFlags.Let || node.flags & ts.NodeFlags.Let) this.addOperatorsToAllHalstead(['let']);
        if (node.flags == ts.NodeFlags.Const || node.flags & ts.NodeFlags.Const)
            this.addOperatorsToAllHalstead(['const']);

        const maxLoop = node.declarations.length - 1;
        node.declarations.forEach((declaration, i) => {
            if (this.dev)
                console.log(`${this.indent()}• visitVariableDeclarationList visiting declaration`, declaration.kind);
            this.continueWalk(declaration);
            if (i != maxLoop) this.addOperatorsToAllHalstead([',']);
        });
        if (this.dev) console.log(`${this.indent()}• visitVariableDeclarationList [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitVariableDeclaration(node: ts.VariableDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitVariableDeclaration [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        this.continueWalk(node.name);
        if (node.type) {
            this.addOperatorsToAllHalstead([':']);
            this.continueWalk(node.type);
        }
        // TODO - find one that has an initializer...unsure of the OOO
        if (node.initializer) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.initializer);
        }
        if (node.exclamationToken) this.continueWalk(node.exclamationToken);
        if (this.dev) console.log(`${this.indent()}• visitVariableDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitArrowFunction(node: ts.ArrowFunction): boolean {
        if (this.dev) console.log(`${this.indent()}• visitArrowFunction [${node.pos}:${node.end}]`, node);
        this.visitNodeArray(node.parameters, '()', ','); // TODO - solve why some arrow functions have this and others do not
        if (node.equalsGreaterThanToken.pos != node.equalsGreaterThanToken.end) this.addOperatorsToAllHalstead(['=>']);
        this.continueWalk(node.body);
        if (this.dev) console.log(`${this.indent()}• visitArrowFunction [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitAwaitExpression(node: ts.AwaitExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitAwaitExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['await']);
        this.continueWalk(node.expression);
        return false;
    }

    private visitHeritageClause(node: ts.HeritageClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitHeritageClause [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        this.visitNodeArray(node.types, '', ',', false);
        if (this.dev) console.log(`${this.indent()}• visitHeritageClause [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitExpressionWithTypeArguments(node: ts.ExpressionWithTypeArguments): boolean {
        if (this.dev) console.log(`${this.indent()}• visitExpressionWithTypeArguments [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        this.continueWalk(node.expression);
        if (node.typeArguments) this.visitNodeArray(node.typeArguments, '<>');
        if (this.dev)
            console.log(`${this.indent()}• visitExpressionWithTypeArguments [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitNewExpression(node: ts.NewExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNewExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['new']);
        this.continueWalk(node.expression);
        if (node.arguments) this.visitNodeArray(node.arguments, '()');
        return false;
    }

    private visitTypeLiteralNode(node: ts.TypeLiteralNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeLiteralNode [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.members, '{}', ',');
        return false;
    }

    private visitPropertySignature(node: ts.PropertySignature): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPropertySignature [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        if (node.questionToken) this.addOperatorsToAllHalstead(['?']);
        if (node.type) {
            this.addOperatorsToAllHalstead([':']);
            this.continueWalk(node.type);
        }
        return false;
    }

    private visitExportAssignment(node: ts.ExportAssignment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitExportAssignment [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['export']);
        if (node.isExportEquals) {
            this.addOperatorsToAllHalstead(['=']);
        } else {
            this.addOperatorsToAllHalstead(['default']);
        }
        this.continueWalk(node.expression);
        return false;
    }

    private visitModuleBlock(node: ts.ModuleBlock): boolean {
        if (this.dev) console.log(`${this.indent()}• visitModuleBlock [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['{}']);
        this.visitBlockStatements(node.statements);
        return false;
    }

    private visitBlockStatements(statements: ts.NodeArray<ts.Statement>): boolean {
        if (this.dev) console.log(`${this.indent()}• visitBlockStatements`, statements);
        for (const statement of statements) {
            if (statement.flags & ts.NodeFlags.ThisNodeHasError) continue;
            if (this.dev) console.log('** visitSourceFile.statement', statement.pos, statement.end);
            this.continueWalk(statement);
        }

        return false;
    }

    private visitSetAccesssor(node: ts.SetAccessorDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSetAccessor [${node.pos}:${node.end}]`);
        return false;
    }

    private visitFunctionTypeNode(node: ts.FunctionTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitFunctionTypeNode [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.parameters, '()');
        this.addOperatorsToAllHalstead(['=>']);
        this.continueWalk(node.type);
        return false;
    }

    private visitBreakStatement(node: ts.BreakStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitBreakStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['break']);
        return false;
    }

    private visitContinueStatement(node: ts.ContinueStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitContinueStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['continue']);
        return false;
    }

    private visitParenthesizedExpression(node: ts.ParenthesizedExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitParenthesizedExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['()']);
        this.continueWalk(node.expression);
        return false;
    }

    private visitUnionTypeNode(node: ts.UnionTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitUnionTypeNode [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.types, '', '|', false);
        return false;
    }

    private visitTypeQueryNode(node: ts.TypeQueryNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeQueryNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['typeof']);
        this.continueWalk(node.exprName);
        return false;
    }

    private visitArrayLiteralExpression(node: ts.ArrayLiteralExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitArrayLiteralExpression [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements, '[]');
        return false;
    }

    private visitObjectBindingPattern(node: ts.ObjectBindingPattern): boolean {
        if (this.dev) console.log(`${this.indent()}• visitObjectBindingPattern [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements, '{}');
        return false;
    }

    private visitBindingElement(node: ts.BindingElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitBindingElement [${node.pos}:${node.end}]`);
        if (node.propertyName) {
            this.continueWalk(node.propertyName);
            this.addOperatorsToAllHalstead([':']);
        }
        this.continueWalk(node.name);
        return false;
    }

    private visitObjectLiteralExpression(node: ts.ObjectLiteralExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitObjectLiteralExpression [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.properties, '{}');
        return false;
    }

    private visitShorthandPropertyAssignment(node: ts.ShorthandPropertyAssignment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitShorthandPropertyAssignment [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        return false;
    }

    private visitPropertyAssignment(node: ts.PropertyAssignment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPropertyAssignment [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.initializer);
        return false;
    }

    private visitQualifiedName(node: ts.QualifiedName): boolean {
        if (this.dev) console.log(`${this.indent()}• visitQualifiedName [${node.pos}:${node.end}]`);
        this.continueWalk(node.left);
        this.addOperatorsToAllHalstead(['.']);
        this.continueWalk(node.right);
        return false;
    }

    private visitPrivateIdentifier(node: ts.PrivateIdentifier): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPrivateIdentifier [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([node.escapedText.toString()]);
        return false;
    }

    private visitJsxText(node: ts.JsxText): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxText [${node.pos}:${node.end}]`);
        let text = node.text.replace(/(\r\n\s*|\n\s*|\r\s*)/gm, '');
        if (text == '') return false;
        this.addOperandsToAllHalstead([`"${text}"`]);
        return false;
    }
    private visitRegularExpressionLiteral(node: ts.RegularExpressionLiteral): boolean {
        if (this.dev) console.log(`${this.indent()}• visitRegularExpressionLiteral [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([node.text]);
        return false;
    }
    private visitNoSubstitutionTemplateLiteral(node: ts.NoSubstitutionTemplateLiteral): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNoSubstitutionTemplateLiteral [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([`"${node.text}"`]);
        return false;
    }
    private visitTemplateHead(node: ts.TemplateHead): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateHead [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([`"${node.text}"`]);
        return false;
    }
    private visitTemplateMiddle(node: ts.TemplateMiddle): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateMiddle [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([`"${node.text}"`]);
        return false;
    }
    private visitTemplateTail(node: ts.TemplateTail): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateTail [${node.pos}:${node.end}]`);
        this.addOperandsToAllHalstead([`"${node.text}"`]);
        return false;
    }
    private visitDotDotDotToken(node: ts.DotDotDotToken): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDotDotDotToken [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['...']);
        return false;
    }
    private visitPlusToken(node: ts.PlusToken): boolean {
        if (this.dev) console.log(`${this.indent()}• visitPlusToken [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['+']);
        return false;
    }
    private visitMinusToken(node: ts.MinusToken): boolean {
        if (this.dev) console.log(`${this.indent()}• visitMinusToken [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['-']);
        return false;
    }
    private visitDecorator(node: ts.Decorator): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDecorator [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['@']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitIndexSignatureDeclaration(node: ts.IndexSignatureDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitIndexSignatureDeclaration [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['[]']);
        this.visitNodeArray(node.parameters, '', ',', false);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.type);
        return false;
    }
    private visitTypePredicateNode(node: ts.TypePredicateNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypePredicateNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.parameterName);
        if (node.type) {
            this.addOperatorsToAllHalstead(['is']);
            this.continueWalk(node.type);
        }
        return false;
    }
    private visitConstructorTypeNode(node: ts.ConstructorTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitConstructorTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['new']);
        this.visitNodeArray(node.parameters, '()');
        this.addOperatorsToAllHalstead(['=>']);
        this.continueWalk(node.type);
        return false;
    }
    private visitTupleTypeNode(node: ts.TupleTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTupleTypeNode [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements, '[]');
        return false;
    }
    private visitOptionalTypeNode(node: ts.OptionalTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitOptionalTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.type);
        this.addOperatorsToAllHalstead(['?']);
        return false;
    }
    private visitRestTypeNode(node: ts.RestTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitRestTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['...']);
        this.continueWalk(node.type);
        return false;
    }
    private visitIntersectionTypeNode(node: ts.IntersectionTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitIntersectionTypeNode [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.types, '', '&', false);
        return false;
    }
    private visitConditionalTypeNode(node: ts.ConditionalTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitConditionalTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.checkType);
        this.addOperatorsToAllHalstead(['extends']);
        this.continueWalk(node.extendsType);
        this.addOperatorsToAllHalstead(['?']);
        this.continueWalk(node.trueType);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.falseType);
        return false;
    }
    private visitInferTypeNode(node: ts.InferTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitInferTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['infer']);
        this.continueWalk(node.typeParameter);
        return false;
    }
    private visitParenthesizedTypeNode(node: ts.ParenthesizedTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitParenthesizedTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['()']);
        this.continueWalk(node.type);
        return false;
    }
    private visitThisTypeNode(node: ts.ThisTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitThisTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['this']);
        return false;
    }
    private visitTypeOperatorNode(node: ts.TypeOperatorNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeOperatorNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead([keywordToStringMap.get(node.operator)!]);
        this.continueWalk(node.type);
        return false;
    }
    private visitIndexedAccessTypeNode(node: ts.IndexedAccessTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitIndexedAccessTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.objectType);
        this.addOperatorsToAllHalstead(['[]']);
        this.continueWalk(node.indexType);
        return false;
    }
    private visitMappedTypeNode(node: ts.MappedTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitMappedTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['{}']);
        this.continueWalk(node.typeParameter);
        if (node.type) {
            this.addOperatorsToAllHalstead([':']);
            this.continueWalk(node.type);
        }
        return false;
    }
    private visitLiteralTypeNode(node: ts.LiteralTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitLiteralTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.literal);
        return false;
    }
    private visitImportTypeNode(node: ts.ImportTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitImportTypeNode [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['typeof', 'import', '()']);
        this.continueWalk(node.argument);
        this.addOperatorsToAllHalstead(['.']);
        if (node.qualifier) this.continueWalk(node.qualifier);
        return false;
    }
    private visitTemplateLiteralTypeSpan(node: ts.TemplateLiteralTypeSpan): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateLiteralTypeSpan [${node.pos}:${node.end}]`);
        this.continueWalk(node.type);
        this.continueWalk(node.literal);
        return false;
    }
    private visitTemplateLiteralTypeNode(node: ts.TemplateLiteralTypeNode): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateLiteralTypeNode [${node.pos}:${node.end}]`);
        this.continueWalk(node.head);
        this.visitNodeArray(node.templateSpans, '', ',', false);
        return false;
    }
    private visitArrayBindingPattern(node: ts.ArrayBindingPattern): boolean {
        if (this.dev) console.log(`${this.indent()}• visitArrayBindingPattern [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements, '[]');
        return false;
    }
    private visitElementAccessExpression(node: ts.ElementAccessExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitElementAccessExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.expression);
        this.addOperatorsToAllHalstead(['[]']);
        this.continueWalk(node.argumentExpression);
        return false;
    }
    private visitTaggedTemplateExpression(node: ts.TaggedTemplateExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTaggedTemplateExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.tag);
        this.continueWalk(node.template);
        if (this.dev) console.log(`${this.indent()}• visitTaggedTemplateExpression <<EXIT>>`);
        return false;
    }
    private visitTypeAssertionExpression(node: ts.TypeAssertion): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeAssertionExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['<>']);
        this.continueWalk(node.type);
        this.continueWalk(node.expression);
        return false;
    }
    private visitDeleteExpression(node: ts.DeleteExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDeleteExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['delete']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitTypeOfExpression(node: ts.TypeOfExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeOfExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['typeof']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitVoidExpression(node: ts.VoidExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitVoidExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['void']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitConditionalExpression(node: ts.ConditionalExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitConditionalExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.condition);
        this.addOperatorsToAllHalstead(['?']);
        this.continueWalk(node.whenTrue);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.whenFalse);
        return false;
    }
    private visitTemplateExpression(node: ts.TemplateExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.head);
        this.visitNodeArray(node.templateSpans, '', '', false, false);
        return false;
    }
    private visitYieldExpression(node: ts.YieldExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitYieldExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['yield']);
        if (node.asteriskToken) this.addOperatorsToAllHalstead(['*']);
        if (node.expression) this.continueWalk(node.expression);
        return false;
    }
    private visitSpreadElement(node: ts.SpreadElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSpreadElement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['...']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitClassExpression(node: ts.ClassExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitClassExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['class']);
        if (node.heritageClauses) {
            this.visitNodeArray(node.heritageClauses, '', ',', false);
        }
        if (node.members) {
            this.visitNodeArray(node.members, '{}', ',', true, false);
        }
        return false;
    }
    private visitOmittedExpression(node: ts.OmittedExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitOmittedExpression [${node.pos}:${node.end}]`);
        return false;
    }
    private visitAsExpression(node: ts.AsExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitAsExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.expression);
        this.addOperatorsToAllHalstead(['as']);
        this.continueWalk(node.type);
        return false;
    }
    private visitNonNullExpression(node: ts.NonNullExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNonNullExpression [${node.pos}:${node.end}]`);
        this.continueWalk(node.expression);
        this.addOperatorsToAllHalstead(['!']);
        return false;
    }
    private visitMetaProperty(node: ts.MetaProperty): boolean {
        if (this.dev) console.log(`${this.indent()}• visitMetaProperty [${node.pos}:${node.end}]`);
        this.visitKeyword(node.keywordToken);
        this.addOperatorsToAllHalstead(['.']);
        this.continueWalk(node.name);
        return false;
    }
    private visitSyntheticExpression(node: ts.SyntheticExpression): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitSyntheticExpression [${node.pos}:${node.end}]`);
        return false;
    }
    private visitPartiallyEmittedExpression(node: ts.PartiallyEmittedExpression): boolean {
        if (this.dev)
            console.log(`!!!!!!!!!${this.indent()}• visitPartiallyEmittedExpression [${node.pos}:${node.end}]`);
        return false;
    }
    private visitCommaListExpression(node: ts.CommaListExpression): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitCommaListExpression [${node.pos}:${node.end}]`);
        return false;
    }
    private visitTemplateSpan(node: ts.TemplateSpan): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTemplateSpan [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['${}']);
        this.continueWalk(node.expression);
        this.continueWalk(node.literal);
        return false;
    }
    private visitSemicolonClassElement(node: ts.SemicolonClassElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSemicolonClassElement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead([';']);
        return false;
    }
    private visitEmptyStatement(node: ts.EmptyStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitEmptyStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead([';']);
        return false;
    }
    private visitDoStatement(node: ts.DoStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDoStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['do']);
        this.continueWalk(node.statement);
        this.addOperatorsToAllHalstead(['while', '()']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitWhileStatement(node: ts.WhileStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitWhileStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['while', '()']);
        this.continueWalk(node.expression);
        this.continueWalk(node.statement);
        return false;
    }
    private visitForInForOfStatement(node: ts.ForInStatement | ts.ForOfStatement, inOf: string): boolean {
        if (this.dev) console.log(`${this.indent()}• visitForInStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['for', '()']);
        this.continueWalk(node.initializer);
        this.addOperatorsToAllHalstead([inOf]);
        this.continueWalk(node.expression);
        this.continueWalk(node.statement);
        return false;
    }
    private visitWithStatement(node: ts.WithStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitWithStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['with', '()']);
        this.continueWalk(node.expression);
        this.continueWalk(node.statement);
        return false;
    }
    private visitSwitchStatement(node: ts.SwitchStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSwitchStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['switch', '()']);
        this.continueWalk(node.expression);
        this.continueWalk(node.caseBlock);
        return false;
    }
    private visitLabeledStatement(node: ts.LabeledStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitLabeledStatement [${node.pos}:${node.end}]`);
        this.continueWalk(node.label);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.statement);
        return false;
    }
    private visitThrowStatement(node: ts.ThrowStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitThrowStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['throw']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitTryStatement(node: ts.TryStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTryStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['try']);
        this.visitBlock(node.tryBlock);
        if (node.catchClause) this.continueWalk(node.catchClause);
        return false;
    }
    private visitDebuggerStatement(node: ts.DebuggerStatement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDebuggerStatement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['debugger']);
        return false;
    }
    private visitEnumDeclaration(node: ts.EnumDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitEnumDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['enum']);
        return false;
    }
    private visitCaseBlock(node: ts.CaseBlock): boolean {
        if (this.dev) console.log(`${this.indent()}• visitCaseBlock [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['{}']);
        this.visitNodeArray(node.clauses, '', '', false, false);
        return false;
    }
    private visitNamespaceExportDeclaration(node: ts.NamespaceExportDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNamespaceExportDeclaration [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['export', 'as', 'namespace']);
        this.continueWalk(node.name);
        return false;
    }
    private visitImportClause(node: ts.ImportClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitImportClause [${node.pos}:${node.end}]`);
        if (node.isTypeOnly) this.addOperatorsToAllHalstead(['type']);
        if (node.name) this.continueWalk(node.name);
        if (node.namedBindings) this.continueWalk(node.namedBindings);
        return false;
    }
    private visitImportTypeAssertionContainer(node: ts.ImportTypeAssertionContainer): boolean {
        if (this.dev)
            console.log(`!!!!!!!!!${this.indent()}• visitImportTypeAssertionContainer [${node.pos}:${node.end}]`);
        return false;
    }
    private visitAssertClause(node: ts.AssertClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitAssertClause [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['assert']);
        this.visitNodeArray(node.elements);
        return false;
    }
    private visitAssertEntry(node: ts.AssertEntry): boolean {
        if (this.dev) console.log(`${this.indent()}• visitAssertEntry [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        this.addOperatorsToAllHalstead([':']);
        this.continueWalk(node.value);
        return false;
    }
    private visitNamespaceExport(node: ts.NamespaceExport): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNamespaceExport [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['*', 'as']);
        this.continueWalk(node.name);
        return false;
    }
    private visitImportSpecifier(node: ts.ImportSpecifier): boolean {
        if (this.dev) console.log(`${this.indent()}• visitImportSpecifier [${node.pos}:${node.end}]`);
        if (node.isTypeOnly) this.addOperatorsToAllHalstead(['type']);
        if (node.propertyName) {
            this.continueWalk(node.propertyName);
            this.addOperatorsToAllHalstead(['as']);
        }
        this.continueWalk(node.name);
        return false;
    }
    private visitNamedExports(node: ts.NamedExports): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNamedExports [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.elements, '{}', ',');
        return false;
    }
    private visitExportSpecifier(node: ts.ExportSpecifier): boolean {
        if (this.dev) console.log(`${this.indent()}• visitExportSpecifier [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        return false;
    }
    private visitMissingDeclaration(node: ts.MissingDeclaration): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitMissingDeclaration [${node.pos}:${node.end}]`);
        return false;
    }
    private visitNotEmittedStatement(node: ts.NotEmittedStatement): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitNotEmittedStatement [${node.pos}:${node.end}]`);
        return false;
    }
    private visitExternalModuleReference(node: ts.ExternalModuleReference): boolean {
        if (this.dev) console.log(`${this.indent()}• visitExternalModuleReference [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['require', '()']);
        this.continueWalk(node.expression);
        return false;
    }

    private visitJsxElementStartingNode(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement): boolean {
        this.continueWalk(node.tagName);
        this.continueWalk(node.attributes);
        return false;
    }

    private visitJsxElement(node: ts.JsxElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxElement [${node.pos}:${node.end}]`);
        this.continueWalk(node.openingElement);
        this.visitNodeArray(node.children, '', '', false, false);
        this.continueWalk(node.closingElement);
        return false;
    }
    private visitJsxSelfClosingElement(node: ts.JsxSelfClosingElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxSelfClosingElement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['< />']);
        this.visitJsxElementStartingNode(node);
        return false;
    }
    private visitJsxOpeningElement(node: ts.JsxOpeningElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxOpeningElement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['<>']);
        this.visitJsxElementStartingNode(node);
        return false;
    }
    private visitJsxClosingElement(node: ts.JsxClosingElement): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxClosingElement [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['</>']);
        this.continueWalk(node.tagName);
        return false;
    }
    private visitJsxFragment(node: ts.JsxFragment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxFragment [${node.pos}:${node.end}]`);
        this.continueWalk(node.openingFragment);
        this.visitNodeArray(node.children, '', '', false, false);
        this.continueWalk(node.closingFragment);
        return false;
    }
    private visitJsxOpeningFragment(node: ts.JsxOpeningFragment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxOpeningFragment [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['<>']);
        return false;
    }
    private visitJsxClosingFragment(node: ts.JsxClosingFragment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxClosingFragment [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['</>']);
        return false;
    }
    private visitJsxAttribute(node: ts.JsxAttribute): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxAttribute [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        if (node.initializer) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.initializer);
        }
        return false;
    }
    private visitJsxAttributes(node: ts.JsxAttributes): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxAttributes [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.properties, '', '', false, false);
        return false;
    }
    private visitJsxSpreadAttribute(node: ts.JsxSpreadAttribute): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxSpreadAttribute [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['...']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitJsxExpression(node: ts.JsxExpression): boolean {
        if (this.dev) console.log(`${this.indent()}• visitJsxExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['{}']);
        if (node.dotDotDotToken) this.addOperatorsToAllHalstead(['...']);
        if (node.expression) this.continueWalk(node.expression);
        return false;
    }
    private visitCaseClause(node: ts.CaseClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitCaseClause [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['case']);
        this.continueWalk(node.expression);
        this.addOperatorsToAllHalstead([':']);
        this.visitBlockStatements(node.statements);
        return false;
    }
    private visitDefaultClause(node: ts.DefaultClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitDefaultClause [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['default', ':']);
        this.visitBlockStatements(node.statements);
        return false;
    }
    private visitCatchClause(node: ts.CatchClause): boolean {
        if (this.dev) console.log(`${this.indent()}• visitCatchClause [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['catch']);
        if (node.variableDeclaration) {
            this.addOperatorsToAllHalstead(['()']);
            this.continueWalk(node.variableDeclaration);
        }
        this.visitBlock(node.block);
        return false;
    }
    private visitSpreadAssignment(node: ts.SpreadAssignment): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSpreadAssignment [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['...']);
        this.continueWalk(node.expression);
        return false;
    }
    private visitEnumMember(node: ts.EnumMember): boolean {
        if (this.dev) console.log(`${this.indent()}• visitEnumMember [${node.pos}:${node.end}]`);
        this.continueWalk(node.name);
        this.addOperatorsToAllHalstead(['=']);
        if (node.initializer) this.continueWalk(node.initializer);
        return false;
    }
    private visitUnparsedPrepend(node: ts.UnparsedPrepend): boolean {
        if (this.dev) console.log(`${this.indent()}• visitUnparsedPrepend [${node.pos}:${node.end}]`);
        console.log('** Parse problem!! **', node);
        return false;
    }
    private visitBundle(node: ts.Bundle): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitBundle [${node.pos}:${node.end}]`);
        return false;
    }
    private visitUnparsedSource(node: ts.UnparsedSource): boolean {
        if (this.dev) console.log(`${this.indent()}• visitUnparsedSource [${node.pos}:${node.end}]`);
        console.log('** Parse problem!! **', node);
        return false;
    }
    private visitJSDocTypeExpression(node: ts.JSDocTypeExpression): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocTypeExpression [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocNameReference(node: ts.JSDocNameReference): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocNameReference [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocMemberName(node: ts.JSDocMemberName): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocMemberName [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocLink(node: ts.JSDocLink): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocLink [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocLinkCode(node: ts.JSDocLinkCode): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocLinkCode [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocLinkPlain(node: ts.JSDocLinkPlain): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocLinkPlain [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocAllType(node: ts.JSDocAllType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocAllType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocUnknownType(node: ts.JSDocUnknownType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocUnknownType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocNullableType(node: ts.JSDocNullableType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocNullableType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocNonNullableType(node: ts.JSDocNonNullableType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocNonNullableType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocOptionalType(node: ts.JSDocOptionalType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocOptionalType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocFunctionType(node: ts.JSDocFunctionType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocFunctionType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocVariadicType(node: ts.JSDocVariadicType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocVariadicType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocNamepathType(node: ts.JSDocNamepathType): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocNamepathType [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDoc(node: ts.JSDoc): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDoc(node [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocTypeLiteral(node: ts.JSDocTypeLiteral): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocTypeLiteral [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocSignature(node: ts.JSDocSignature): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocSignature [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocAugmentsTag(node: ts.JSDocAugmentsTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocAugmentsTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocAuthorTag(node: ts.JSDocAuthorTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocAuthorTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocClassTag(node: ts.JSDocClassTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocClassTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocCallbackTag(node: ts.JSDocCallbackTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocCallbackTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocPublicTag(node: ts.JSDocPublicTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocPublicTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocPrivateTag(node: ts.JSDocPrivateTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocPrivateTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocProtectedTag(node: ts.JSDocProtectedTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocProtectedTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocReadonlyTag(node: ts.JSDocReadonlyTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocReadonlyTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocOverrideTag(node: ts.JSDocOverrideTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocOverrideTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocDeprecatedTag(node: ts.JSDocDeprecatedTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocDeprecatedTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocSeeTag(node: ts.JSDocSeeTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocSeeTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocEnumTag(node: ts.JSDocEnumTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocEnumTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocParameterTag(node: ts.JSDocParameterTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocParameterTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocReturnTag(node: ts.JSDocReturnTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocReturnTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocThisTag(node: ts.JSDocThisTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocThisTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocTypeTag(node: ts.JSDocTypeTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocTypeTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocTemplateTag(node: ts.JSDocTemplateTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocTemplateTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocTypedefTag(node: ts.JSDocTypedefTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocTypedefTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocUnknownTag(node: ts.JSDocUnknownTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocUnknownTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocPropertyTag(node: ts.JSDocPropertyTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocPropertyTag [${node.pos}:${node.end}]`);
        return false;
    }
    private visitJSDocImplementsTag(node: ts.JSDocImplementsTag): boolean {
        if (this.dev) console.log(`!!!!!!!!!${this.indent()}• visitJSDocImplementsTag [${node.pos}:${node.end}]`);
        return false;
    }

    // Declarations
    private visitModuleDeclaration(node: ts.ModuleDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitModuleDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['module']);
        if (this.dev) console.log(`${this.indent()}• visitModuleDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitImportEqualsDeclaration(node: ts.ImportEqualsDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitImportEqualsDeclaration [${node.pos}:${node.end}]`);
        node.modifiers?.forEach((modifier) => this.continueWalk(modifier));
        this.addOperatorsToAllHalstead(['import']);
        this.continueWalk(node.name);
        this.addOperatorsToAllHalstead(['=']);
        this.continueWalk(node.moduleReference);
        return false;
    }

    private visitExportDeclaration(node: ts.ExportDeclaration): boolean {
        // TODO - should this live as a "component"
        if (this.dev) console.log(`${this.indent()}• visitExportDeclaration [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['export']);
        if (node.exportClause) this.continueWalk(node.exportClause);
        if (node.moduleSpecifier) {
            this.addOperatorsToAllHalstead(['from']);
            this.continueWalk(node.moduleSpecifier);
        }
        return false;
    }

    private visitClassDeclaration(node: ts.ClassDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}]`);

        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        // node.decorators?.forEach((decorator) => {
        //     console.log(`${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: visiting decorators`);
        //     this.continueWalk(decorator);
        // });
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(`${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: visiting modifiers`);
            this.continueWalk(modifier);
        });
        this.addOperatorsToAllHalstead(['class']);
        if (node.name) this.continueWalk(node.name);
        if ('typeParameters' in node && node.typeParameters) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: visiting typeParameters`
                );
            this.visitNodeArray(node.typeParameters, '<>');
        }
        if ('heritageClauses' in node && node.heritageClauses) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: visiting heritageClauses`,
                    node.heritageClauses
                );
            this.visitNodeArray(node.heritageClauses, '', ',', false);
        }
        if ('members' in node && node.members) {
            if (this.dev)
                console.log(`${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] :: visiting members`);
            this.visitNodeArray(node.members, '{}', ',', true, false);
            if (node.members.hasTrailingComma) this.addOperatorsToAllHalstead([',']);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev)
            console.log(
                `${this.indent()}• visitClassDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT POPPED FROM HEIRARCHY <--`
            );
        if (this.dev) console.log(`${this.indent()}• visitClassDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitInterfaceDeclaration(node: ts.InterfaceDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}]`);

        if (this.dev)
            console.log(`${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}]`, node.kind, node);
        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        // node.decorators?.forEach((decorator) => {
        //     console.log(`${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] :: visiting decorators`);
        //     this.continueWalk(decorator);
        // });
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] :: visiting modifiers`
                );
            this.continueWalk(modifier);
        });
        this.addOperatorsToAllHalstead(['interface']);
        if (node.name) this.continueWalk(node.name);
        if ('heritageClauses' in node && node.heritageClauses) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] :: visiting heritageClauses`,
                    node.heritageClauses
                );
            this.visitNodeArray(node.heritageClauses, '', ',', false);
        }
        if ('typeParameters' in node && node.typeParameters) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] :: visiting typeParameters`
                );
            this.visitNodeArray(node.typeParameters, '<>');
        }
        if ('members' in node && node.members) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] :: visiting members`
                );
            this.visitNodeArray(node.members, '{}', ',', true, false);
            if (node.members.hasTrailingComma) this.addOperatorsToAllHalstead([',']);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev)
            console.log(
                `${this.indent()}• visitInterfaceDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT POPPED FROM HEIRARCHY <--`
            );

        if (this.dev) console.log(`${this.indent()}• visitInterfaceDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitGetAccessorDeclaration(node: ts.GetAccessorDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitGetAccessorDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['get']);
        if (this.dev) console.log(`${this.indent()}• visitGetAccessorDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitSetAccesssorDeclaration(node: ts.SetAccessorDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitSetAccesssorDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['set']);
        if (this.dev) console.log(`${this.indent()}• visitSetAccesssorDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitConstructSignatureDeclaration(node: ts.ConstructSignatureDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitConstructSignatureDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['new']);
        if (this.dev)
            console.log(`${this.indent()}• visitConstructSignatureDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitCallSignatureDeclaration(node: ts.CallSignatureDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitCallSignatureDeclaration [${node.pos}:${node.end}]`);
        this.visitNodeArray(node.parameters, '()');
        this.addOperatorsToAllHalstead([':']);
        if (node.type) this.continueWalk(node.type);
        if (this.dev) console.log(`${this.indent()}• visitCallSignatureDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitTypeAliasDeclaration(node: ts.TypeAliasDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}]`);

        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        // node.decorators?.forEach((decorator) => {
        //     console.log(`${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}] :: visiting decorators`);
        //     this.continueWalk(decorator);
        // });
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}] :: visiting modifiers`
                );
            this.continueWalk(modifier);
        });
        this.addOperatorsToAllHalstead(['type']);
        if (node.name) this.continueWalk(node.name);
        if ('typeParameters' in node && node.typeParameters) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}] :: visiting typeParameters`
                );
            this.visitNodeArray(node.typeParameters, '<>');
        }
        this.addOperatorsToAllHalstead(['=']);
        if ('type' in node && node.type) {
            if (!ts.isTypeAliasDeclaration(node)) this.addOperatorsToAllHalstead([':']);
            if (this.dev)
                console.log(`${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}] :: visiting type`);
            this.continueWalk(node.type);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev)
            console.log(
                `${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT POPPED FROM HEIRARCHY <--`
            );
        if (this.dev) console.log(`${this.indent()}• visitTypeAliasDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitMethodSignature(node: ts.MethodSignature): boolean {
        if (this.dev) console.log(`${this.indent()}• visitMethodSignature [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, []);
        if (this.dev) console.log(`${this.indent()}• visitMethodSignature [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitConstructorDeclaration(node: ts.ConstructorDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitConstructorDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['constructor']);
        if (this.dev) console.log(`${this.indent()}• visitConstructorDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitMethodDeclaration(node: ts.MethodDeclaration): boolean {
        if (this.dev) console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}]`);

        if (this.dev)
            console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}]`, node.kind, node);
        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitMethodDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        // node.decorators?.forEach((decorator) => {
        //     console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting decorators`);
        //     this.continueWalk(decorator);
        // });
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting modifiers`);
            this.continueWalk(modifier);
        });
        if (node.name) this.continueWalk(node.name);
        if ('asteriskToken' in node && node.asteriskToken) this.addOperatorsToAllHalstead(['*']);
        if ('questionToken' in node && node.questionToken) this.addOperatorsToAllHalstead(['?']);
        if ('parameters' in node) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting parameters`
                );
            this.visitNodeArray(node.parameters, '()');
        }
        if ('type' in node && node.type) {
            if (!ts.isTypeAliasDeclaration(node)) this.addOperatorsToAllHalstead([':']);
            if (this.dev)
                console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting type`);
            this.continueWalk(node.type);
        }
        if ('typeParameters' in node && node.typeParameters) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting typeParameters`
                );
            this.visitNodeArray(node.typeParameters, '<>');
        }
        if ('body' in node && node.body) {
            if (this.dev)
                console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] :: visiting body`);
            this.continueWalk(node.body);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev)
            console.log(
                `${this.indent()}• visitMethodDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT POPPED FROM HEIRARCHY <--`
            );

        if (this.dev) console.log(`${this.indent()}• visitMethodDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitNodeArray(
        nodes:
            | ts.NodeArray<ts.ClassElement>
            | ts.NodeArray<ts.EnumMember>
            | ts.NodeArray<ts.TypeElement>
            | ts.NodeArray<ts.TypeParameterDeclaration>
            | ts.NodeArray<ts.ParameterDeclaration>
            | ts.NodeArray<ts.TypeNode>
            | ts.NodeArray<ts.Expression>
            | ts.NodeArray<ts.HeritageClause>
            | ts.NodeArray<ts.BindingElement>
            | ts.NodeArray<ts.ObjectLiteralElementLike>
            | ts.NodeArray<ts.CaseOrDefaultClause>
            | ts.NodeArray<ts.ExportSpecifier>
            | ts.NodeArray<ts.ImportSpecifier>
            | ts.NodeArray<ts.ArrayBindingElement>
            | ts.NodeArray<ts.AssertEntry>
            | ts.NodeArray<ts.JsxAttributeLike>
            | ts.NodeArray<ts.JsxChild>
            | ts.NodeArray<ts.TemplateSpan>,
        enclosingOperator: string = '{}',
        separator: string = ',',
        includeEnclosingOperator: boolean = true,
        includeSeparator: boolean = true
    ): boolean {
        if (this.dev) console.log(`${this.indent()}• visitNodeArray`);
        if (includeEnclosingOperator) this.addOperatorsToAllHalstead([enclosingOperator]);

        const maxLoop = nodes.length - 1;
        nodes.forEach((node, i) => {
            if (this.dev) console.log(`${this.indent()}• visitNodeArray, maxLoop: ${maxLoop}`, node.kind);
            if ('token' in node) this.visitKeyword(node.token);
            this.continueWalk(node);
            if (i != maxLoop && includeSeparator) {
                if (this.dev) console.log(`${this.indent()}• visitNodeArray adding separator`, separator);
                this.addOperatorsToAllHalstead([separator]);
            }
        });
        if (this.dev) console.log(`${this.indent()}• visitNodeArray <<EXIT>>`);
        return false;
    }

    private visitFunctionDeclaration(node: ts.FunctionDeclaration) {
        if (this.dev) console.log(`${this.indent()}• visitFunctionDeclaration [${node.pos}:${node.end}]`);
        this.visitDeclarationWithBody(node, ['function']);
        if (this.dev) console.log(`${this.indent()}• visitFunctionDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitFunctionExpression(node: ts.FunctionExpression) {
        if (this.dev) console.log(`${this.indent()}• visitFunctionExpression [${node.pos}:${node.end}]`);
        this.addOperatorsToAllHalstead(['function']);
        if (node.name) this.continueWalk(node.name);
        this.visitNodeArray(node.parameters, '()');
        if (node.type) {
            this.addOperatorsToAllHalstead([':']);
            this.continueWalk(node.type);
        }
        this.continueWalk(node.body);
        if (this.dev) console.log(`${this.indent()}• visitFunctionExpression [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitPropertyDeclaration(node: ts.PropertyDeclaration) {
        if (this.dev) console.log(`${this.indent()}• visitPropertyDeclaration [${node.pos}:${node.end}]`);
        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitPropertyDeclaration [${node.pos}:${
                    node.end
                }] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting modifiers`
                );
            this.continueWalk(modifier);
        });
        if (node.name) this.continueWalk(node.name);
        if ('questionToken' in node && node.questionToken) this.addOperatorsToAllHalstead(['?']);
        if (node.type) {
            if (!ts.isTypeAliasDeclaration(node)) this.addOperatorsToAllHalstead([':']);
            if (this.dev)
                console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting type`);
            this.continueWalk(node.type);
        }
        if (node.initializer) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.initializer);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev) console.log(`${this.indent()}• visitPropertyDeclaration [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    private visitDeclarationWithBody(
        node:
            | ts.ModuleDeclaration
            | ts.FunctionDeclaration
            | ts.MethodDeclaration
            | ts.MethodSignature
            | ts.ConstructorDeclaration
            | ts.GetAccessorDeclaration
            | ts.SetAccessorDeclaration
            | ts.ClassStaticBlockDeclaration
            | ts.FunctionExpression
            // |
            | ts.ClassDeclaration
            | ts.EnumDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeParameterDeclaration
            | ts.PropertyDeclaration
            | ts.ConstructSignatureDeclaration
            | ts.VariableDeclaration
            // |
            | ts.TypeAliasDeclaration,
        operatorsToPush: string[]
    ) {
        if (this.dev)
            console.log(
                `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}]`,
                node.kind,
                operatorsToPush,
                node
            );
        let lsifSymbol = this.lsifSymbol(node);

        if (this.underTest) {
            this.pushComponentToHeirarchy(this.lsifCounter.next());
        } else {
            let id = this.emitDeclaration(node, lsifSymbol);
            this.pushComponentToHeirarchy(id);
            this.getAndStoreReferences(id, node);
        }

        if (this.dev)
            console.log(
                `${this.indent()}• visitDeclarationWithBody [${node.pos}:${
                    node.end
                }] :: COMPONENT PUSHED TO HEIRARCHY -->`
            );
        // node.decorators?.forEach((decorator) => {
        //     console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting decorators`);
        //     this.continueWalk(decorator);
        // });
        node.modifiers?.forEach((modifier) => {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting modifiers`
                );
            this.continueWalk(modifier);
        });
        this.addOperatorsToAllHalstead(operatorsToPush);
        if (node.name) this.continueWalk(node.name);
        if ('asteriskToken' in node && node.asteriskToken) this.addOperatorsToAllHalstead(['*']);
        if ('questionToken' in node && node.questionToken) this.addOperatorsToAllHalstead(['?']);
        if ('heritageClauses' in node && node.heritageClauses) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting heritageClauses`,
                    node.heritageClauses
                );
            this.visitNodeArray(node.heritageClauses, '', ',', false);
        }
        if ('typeParameters' in node && node.typeParameters) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting typeParameters`
                );
            this.visitNodeArray(node.typeParameters, '<>');
        }
        if ('parameters' in node) {
            if (this.dev)
                console.log(
                    `${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting parameters`
                );
            this.visitNodeArray(node.parameters, '()');
        }
        if ('initializer' in node && node.initializer) {
            this.addOperatorsToAllHalstead(['=']);
            this.continueWalk(node.initializer);
        }
        if ('type' in node && node.type) {
            if (!ts.isTypeAliasDeclaration(node)) this.addOperatorsToAllHalstead([':']);
            if (this.dev)
                console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting type`);
            this.continueWalk(node.type);
        }
        if ('body' in node && node.body) {
            if (this.dev)
                console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting body`);
            this.continueWalk(node.body);
        }
        if ('members' in node && node.members) {
            if (this.dev)
                console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] :: visiting members`);
            this.visitNodeArray(node.members, '{}', ',', true, true);
            if (node.members.hasTrailingComma) this.addOperatorsToAllHalstead([',']);
        }
        this.popComponentFromHeirarchy(node);
        if (this.dev)
            console.log(
                `${this.indent()}• visitDeclarationWithBody [${node.pos}:${
                    node.end
                }] :: COMPONENT POPPED FROM HEIRARCHY <--`
            );
        if (this.dev) console.log(`${this.indent()}• visitDeclarationWithBody [${node.pos}:${node.end}] <<EXIT>>`);
        return false;
    }

    /**
     * Adds all supplied operands to every corresponding Halstead measurement array (.operands)
     *
     * @param {(string | number | bigint)[]} operands - Operands to add to measurement array
     */
    addOperandsToAllHalstead(operands: (string | number | bigint)[]) {
        this.currentComponentHeirarchyPositions.forEach((position) => {
            this.currentComponentHeirarchy[this.currentComponentHeirarchy.length + position].halstead.operands.push(
                ...operands
            );
            if (this.dev)
                console.log(
                    this.currentComponentHeirarchy[this.currentComponentHeirarchy.length + position].halstead.operands
                );
        });
    }

    /**
     * Adds all supplied operators to every corresponding Halstead measurement array (.operators)
     *
     * @param {string[]} operators - Operators to add to measurement array
     */
    addOperatorsToAllHalstead(operators: string[]) {
        this.currentComponentHeirarchyPositions.forEach((position) => {
            this.currentComponentHeirarchy[this.currentComponentHeirarchy.length + position].halstead.operators.push(
                ...operators
            );
            if (this.dev)
                console.log(
                    this.currentComponentHeirarchy[this.currentComponentHeirarchy.length + position].halstead.operators
                );
        });
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
            | ts.ModuleDeclaration
            | ts.ClassDeclaration
            | ts.EnumDeclaration
            | ts.FunctionDeclaration
            | ts.FunctionExpression
            | ts.ClassStaticBlockDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeParameterDeclaration
            | ts.PropertyDeclaration
            | ts.MethodDeclaration
            | ts.MethodSignature
            | ts.ConstructSignatureDeclaration
            | ts.GetAccessorDeclaration
            | ts.SetAccessorDeclaration
            | ts.PropertyDeclaration
            | ts.ConstructorDeclaration
            | ts.VariableDeclaration
            | ts.TypeAliasDeclaration,
        lsifSymbol: LsifSymbol
    ): number {
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
            | ts.ModuleDeclaration
            | ts.ClassDeclaration
            | ts.ClassStaticBlockDeclaration
            | ts.ConstructorDeclaration
            | ts.ConstructSignatureDeclaration
            | ts.EnumDeclaration
            | ts.FunctionDeclaration
            | ts.FunctionExpression
            | ts.GetAccessorDeclaration
            | ts.InterfaceDeclaration
            | ts.MethodDeclaration
            | ts.MethodSignature
            | ts.PropertyDeclaration
            | ts.SetAccessorDeclaration
            | ts.TypeParameterDeclaration
            | ts.VariableDeclaration
            | ts.TypeAliasDeclaration
    ) {
        if (!node.name) return;
        try {
            const foundReferences = this.languageService.findReferences(this.sourceFile.fileName, node.name.getStart());
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
        } catch (error) {
            if (!error.message.includes('Could not find source file')) {
                Sentry.captureException(error);
                console.error(error);
            }
        }
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

        try {
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
        } catch (error) {
            console.log(error);
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
