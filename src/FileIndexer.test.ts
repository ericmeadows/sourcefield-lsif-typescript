import { test } from 'uvu';

import * as lsif from './lsif';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'uvu/assert';

import { Input } from './Input';
import { FileIndexer } from './FileIndexer';
import * as ts from 'typescript';
import { ProjectOptions } from './CommandLineOptions';
import { Counter } from './Counter';
import { Packages } from './Packages';
import { LsifSymbol } from './LsifSymbol';
import { DefinitionRange } from './DefinitionRange';
import { createLanguageService, ProjectIndexer } from './ProjectIndexer';

let ignoreSkipParameter: boolean = false;

let counter = new Counter();
let options: ProjectOptions = {
    cwd: '/Users/ericmeadows/git/echarts',
    yarnWorkspaces: false,
    yarnBerryWorkspaces: false,
    inferTsconfig: false,
    output: '/Users/ericmeadows/git/lsif-spike/temp/lsif-ts.lsif',
    progressBar: true,
    indexedProjects: new Set<string>(['/Users/ericmeadows/git/echarts']),
    projectRoot: '/Users/ericmeadows/git/echarts',
    projectDisplayName: '/Users/ericmeadows/git/echarts',
    writeIndex: (partialIndex: any): void => {},
    counter,
    explicitTsConfigJson: 'tsconfig.json',
    explicitImplicitLoop: false,
    dev: true,
};

let compilerOptions: ts.CompilerOptions = {
    target: 1,
    noImplicitAny: true,
    noImplicitThis: true,
    strictBindCallApply: true,
    removeComments: false,
    sourceMap: true,
    moduleResolution: 2,
    declaration: true,
    declarationMap: false,
    jsx: ts.JsxEmit.ReactJSX,
    importHelpers: true,
    pretty: true,
    outDir: '/Users/ericmeadows/git/echarts/lib',
    configFilePath: undefined,
};
let program = ts.createProgram([], compilerOptions);
let checker = program.getTypeChecker();
let packages = new Packages(options.projectRoot);
let symbolCache: Map<ts.Node, LsifSymbol> = new Map();

const filesToIndex: ts.SourceFile[] = [];

const declarations: Map<number, DefinitionRange> = new Map<number, DefinitionRange>();
const references: Map<number, DefinitionRange[]> = new Map<number, DefinitionRange[]>();
const languageService = createLanguageService(
    filesToIndex.map(function (file) {
        return file.fileName;
    }),
    {}
);

type TestArray = {
    name: string;
    codeToParse: string;
    numItemsInHeirarchy: number;
    operandsDesired: (string | number | bigint)[][];
    operatorsDesired: string[][];
    skip: boolean;
    scriptKind?: ts.ScriptKind;
};

const testItems: TestArray[] = [
    {
        name: 'simple function',
        skip: false,
        codeToParse: `
    export function log(str: string, onlyOnce?: boolean) {
      outputLog("log", str, onlyOnce);
    }
            `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['log', 'str', 'onlyOnce', 'outputLog', '"log"', 'str', 'onlyOnce'],
            ['log', 'str', 'onlyOnce', 'outputLog', '"log"', 'str', 'onlyOnce'],
        ],
        operatorsDesired: [
            ['export', 'function', '()', ':', 'string', ',', '?', ':', 'boolean', '{}', '()', ',', ','],
            ['export', 'function', '()', ':', 'string', ',', '?', ':', 'boolean', '{}', '()', ',', ','],
        ],
    },
    {
        name: '2dArrays (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/2dArrays.ts)',
        skip: false,
        codeToParse: `
    class Cell {
    }

    class Ship {
        isSunk: boolean;
    }

    class Board {
        ships: Ship[];
        cells: Cell[];

        private allShipsSunk() {
            return this.ships.every(function (val) { return val.isSunk; });
        }
    }
            `,
        numItemsInHeirarchy: 8,
        operandsDesired: [
            [
                'Cell',
                'Ship',
                'isSunk',
                'Board',
                'ships',
                'Ship',
                'cells',
                'Cell',
                'allShipsSunk',
                'ships',
                'every',
                'val',
                'val',
                'isSunk',
            ],
            ['Cell'],
            ['Ship', 'isSunk'],
            ['isSunk'],
            ['Board', 'ships', 'Ship', 'cells', 'Cell', 'allShipsSunk', 'ships', 'every', 'val', 'val', 'isSunk'],
            ['ships', 'Ship'],
            ['cells', 'Cell'],
            ['allShipsSunk', 'ships', 'every', 'val', 'val', 'isSunk'],
        ],
        operatorsDesired: [
            [
                'class',
                '{}',
                'class',
                '{}',
                ':',
                'boolean',
                'class',
                '{}',
                ':',
                '[]',
                ':',
                '[]',
                'private',
                '()',
                '{}',
                'return',
                'this',
                '.',
                '.',
                '()',
                'function',
                '()',
                '{}',
                'return',
                '.',
            ],
            ['class', '{}'],
            [
                'class',
                '{}',
                ':',
                'boolean',
                //  ';'
            ],
            [':', 'boolean'],
            [
                'class',
                '{}',
                ':',
                '[]',
                // ';',
                ':',
                '[]',
                // ';',
                'private',
                '()',
                '{}',
                'return',
                'this',
                '.',
                '.',
                '()',
                'function',
                '()',
                '{}',
                'return',
                '.',
                // ';',
                // ';',
            ],
            [
                ':',
                '[]',
                // ';'
            ],
            [
                ':',
                '[]',
                // ';'
            ],
            [
                'private',
                '()',
                '{}',
                'return',
                'this',
                '.',
                '.',
                '()',
                'function',
                '()',
                '{}',
                'return',
                '.',
                // ';',
                // ';',
            ],
        ],
    },
    {
        name: 'ArrowFunctionExpression (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ArrowFunctionExpression1.ts)',
        skip: false,
        codeToParse: `
var v = (public x: string) => { };
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['v', 'x']],
        operatorsDesired: [
            [
                'var',
                '=',
                '()',
                'public',
                ':',
                'string',
                '=>',
                '{}',
                // ';'
            ],
        ],
    },
    {
        name: 'ClassDeclaration10 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration10.ts)',
        skip: false,
        codeToParse: `
class C {
   constructor();
   foo();
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', 'foo'], ['C', 'foo'], [], ['foo']],
        operatorsDesired: [
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';',
                '()',
                // ';',
            ],
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';',
                '()',
                // ';',
            ],
            [
                'constructor',
                '()',
                // ';',
            ],
            [
                '()',
                // ';',
            ],
        ],
    },
    {
        name: 'ClassDeclaration11 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration11.ts)',
        skip: false,
        codeToParse: `
class C {
   constructor();
   foo() { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', 'foo'], ['C', 'foo'], [], ['foo']],
        operatorsDesired: [
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                'constructor',
                '()',
                // ';',
            ],
            ['()', '{}'],
        ],
    },
    {
        name: 'ClassDeclaration13 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration13.ts)',
        skip: false,
        codeToParse: `
class C {
   foo();
   bar() { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', 'foo', 'bar'], ['C', 'foo', 'bar'], ['foo'], ['bar']],
        operatorsDesired: [
            [
                'class',
                '{}',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                'class',
                '{}',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                '()',
                // ';',
            ],
            ['()', '{}'],
        ],
    },
    {
        name: 'ClassDeclaration15 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration15.ts)',
        skip: false,
        codeToParse: `
class C {
   foo();
   constructor() { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', 'foo'], ['C', 'foo'], ['foo'], []],
        operatorsDesired: [
            [
                'class',
                '{}',
                '()',
                // ';',
                'constructor',
                '()',
                '{}',
            ],
            [
                'class',
                '{}',
                '()',
                // ';',
                'constructor',
                '()',
                '{}',
            ],
            [
                '()',
                // ';',
            ],
            ['constructor', '()', '{}'],
        ],
    },
    {
        name: 'ClassDeclaration21 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration21.ts)',
        skip: false,
        codeToParse: `
class C {
    0();
    1() { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', '0', '1'], ['C', '0', '1'], ['0'], ['1']],
        operatorsDesired: [['class', '{}', '()', '()', '{}'], ['class', '{}', '()', '()', '{}'], ['()'], ['()', '{}']],
    },
    {
        name: 'ClassDeclaration22 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration22.ts)',
        skip: false,
        codeToParse: `
class C {
    "foo"();
    "bar"() { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', '"foo"', '"bar"'], ['C', '"foo"', '"bar"'], ['"foo"'], ['"bar"']],
        operatorsDesired: [
            [
                'class',
                '{}',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                'class',
                '{}',
                '()',
                // ';',
                '()',
                '{}',
            ],
            [
                '()',
                // ';'
            ],
            ['()', '{}'],
        ],
    },
    {
        name: 'ClassDeclaration24 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration24.ts)',
        skip: false,
        codeToParse: `
class any {
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [[], []],
        operatorsDesired: [
            ['class', 'any', '{}'],
            ['class', 'any', '{}'],
        ],
    },
    {
        name: 'ClassDeclaration25 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration25.ts)',
        skip: false,
        codeToParse: `
interface IList<T> {
    data(): T;
    next(): string;
}
class List<U> implements IList<U> {
    data(): U;
    next(): string;
}
        `,
        numItemsInHeirarchy: 7,
        operandsDesired: [
            ['IList', 'T', 'data', 'T', 'next', 'List', 'U', 'IList', 'U', 'data', 'U', 'next'],
            ['IList', 'T', 'data', 'T', 'next'],
            ['data', 'T'],
            ['next'],
            ['List', 'U', 'IList', 'U', 'data', 'U', 'next'],
            ['data', 'U'],
            ['next'],
        ],
        operatorsDesired: [
            [
                'interface',
                '<>',
                '{}',
                '()',
                ':',
                // ';',
                '()',
                ':',
                'string',
                // ';'
                'class',
                '<>',
                'implements',
                '<>',
                '{}',
                '()',
                ':',
                // ';',
                '()',
                ':',
                // ';',
                'string',
            ],
            [
                'interface',
                '<>',
                '{}',
                '()',
                ':',
                // ';',
                '()',
                ':',
                'string',
                // ';'
            ],
            [
                '()',
                ':',
                // ';'
            ],
            [
                '()',
                ':',
                'string',
                // ';'
            ],
            [
                'class',
                '<>',
                'implements',
                '<>',
                '{}',
                '()',
                ':',
                // ';',
                '()',
                ':',
                'string',
                // ';'
            ],
            [
                '()',
                ':',
                // ';'
            ],
            [
                '()',
                ':',
                'string',
                // ';'
            ],
        ],
    },
    {
        name: 'ClassDeclaration26 -- parse error! (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration26.ts)',
        skip: false,
        codeToParse: `
class C {
    public const var export foo = 10;

    var constructor() { }
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [[]],
        operatorsDesired: [['()', '{}']],
    },
    {
        name: 'ClassDeclaration8 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration8.ts)',
        skip: false,
        codeToParse: `
class C {
  constructor();
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['C'], ['C'], []],
        operatorsDesired: [
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';'
            ],
            [
                'class',
                '{}',
                'constructor',
                '()',
                // ';'
            ],
            [
                'constructor',
                '()',
                // ';'
            ],
        ],
    },
    {
        name: 'ClassDeclaration9 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclaration9.ts)',
        skip: false,
        codeToParse: `
class C {
   foo();
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['C', 'foo'], ['C', 'foo'], ['foo']],
        operatorsDesired: [
            [
                'class',
                '{}',
                '()',
                // ';'
            ],
            [
                'class',
                '{}',
                '()',
                // ';'
            ],
            [
                '()',
                // ';'
            ],
        ],
    },
    {
        name: 'ClassDeclarationWithInvalidConstOnPropertyDeclaration (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclarationWithInvalidConstOnPropertyDeclaration.ts)',
        skip: false,
        codeToParse: `
class AtomicNumbers {
  static const H = 1;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['AtomicNumbers', 'H', '1'],
            ['AtomicNumbers', 'H', '1'],
            ['H', '1'],
        ],
        operatorsDesired: [
            [
                'class',
                '{}',
                'static',
                'const',
                '=',
                // ';'
            ],
            [
                'class',
                '{}',
                'static',
                'const',
                '=',
                // ';'
            ],
            [
                'static',
                'const',
                '=',
                // ';'
            ],
        ],
    },
    {
        name: 'ClassDeclarationWithInvalidConstOnPropertyDeclaration2 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ClassDeclarationWithInvalidConstOnPropertyDeclaration2.ts)',
        skip: false,
        codeToParse: `
class C {
    const
    x = 10;
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [['C', 'x', '10'], ['C', 'x', '10'], [], ['x', '10']],
        operatorsDesired: [
            [
                'class',
                '{}',
                'const',
                '=',
                // ';'
            ],
            [
                'class',
                '{}',
                'const',
                '=',
                // ';'
            ],
            ['const'],
            [
                '=',
                // ';'
            ],
        ],
    },
    {
        name: 'DateTimeFormatAndNumberFormatES2021 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/DateTimeFormatAndNumberFormatES2021.ts)',
        skip: false,
        codeToParse: `
// @lib: es2021
Intl.NumberFormat.prototype.formatRange
Intl.DateTimeFormat.prototype.formatRange

new Intl.NumberFormat().formatRange
new Intl.NumberFormat().formatRangeToParts
new Intl.DateTimeFormat().formatRange
new Intl.DateTimeFormat().formatRangeToParts
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'Intl',
                'NumberFormat',
                'prototype',
                'formatRange',
                'Intl',
                'DateTimeFormat',
                'prototype',
                'formatRange',
                'Intl',
                'NumberFormat',
                'formatRange',
                'Intl',
                'NumberFormat',
                'formatRangeToParts',
                'Intl',
                'DateTimeFormat',
                'formatRange',
                'Intl',
                'DateTimeFormat',
                'formatRangeToParts',
            ],
        ],
        operatorsDesired: [
            [
                '.',
                '.',
                '.',
                '.',
                '.',
                '.',
                'new',
                '.',
                '()',
                '.',
                'new',
                '.',
                '()',
                '.',
                'new',
                '.',
                '()',
                '.',
                'new',
                '.',
                '()',
                '.',
            ],
        ],
    },
    {
        name: 'DeclarationErrorsNoEmitOnError (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/DeclarationErrorsNoEmitOnError.ts)',
        skip: false,
        codeToParse: `
// @module: commonjs
// @declaration: true
// @noEmitOnError: true

type T = { x : number }
export interface I {
    f: T;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['T', 'x', 'I', 'f', 'T'],
            ['T', 'x'],
            ['I', 'f', 'T'],
        ],
        operatorsDesired: [
            [
                'type',
                '=',
                '{}',
                ':',
                'number',
                'export',
                'interface',
                '{}',
                ':',
                // ';'
            ],
            ['type', '=', '{}', ':', 'number'],
            [
                'export',
                'interface',
                '{}',
                ':',
                // ';'
            ],
        ],
    },
    {
        name: 'ExportAssignment7 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ExportAssignment7.ts)',
        skip: false,
        codeToParse: `
export class C {
}

export = B;
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [['C', 'B'], ['C']],
        operatorsDesired: [
            [
                'export',
                'class',
                '{}',
                'export',
                '=',
                // ';'
            ],
            ['export', 'class', '{}'],
        ],
    },
    {
        name: 'ExportAssignment8 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ExportAssignment8.ts)',
        skip: false,
        codeToParse: `
export = B;

export class C {
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [['B', 'C'], ['C']],
        operatorsDesired: [
            [
                'export',
                '=',
                'export',
                'class',
                '{}',
                // ';'
            ],
            ['export', 'class', '{}'],
        ],
    },
    {
        name: 'FunctionDeclaration3 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/FunctionDeclaration3.ts)',
        skip: false,
        codeToParse: `
function foo();
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [['foo'], ['foo']],
        operatorsDesired: [
            ['function', '()'],
            ['function', '()'],
        ],
    },
    {
        name: 'FunctionDeclaration4 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/FunctionDeclaration4.ts)',
        skip: false,
        codeToParse: `
function foo();
function bar() { }
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['foo', 'bar'], ['foo'], ['bar']],
        operatorsDesired: [
            [
                'function',
                '()',
                // ';',
                'function',
                '()',
                '{}',
            ],
            [
                'function',
                '()',
                // ';',
            ],
            ['function', '()', '{}'],
        ],
    },
    {
        name: 'FunctionDeclaration6 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/FunctionDeclaration6.ts)',
        skip: false,
        codeToParse: `
{
    function foo();
    function bar() { }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['foo', 'bar'], ['foo'], ['bar']],
        operatorsDesired: [
            [
                '{}',
                'function',
                '()',
                // ';',
                'function',
                '()',
                '{}',
            ],
            [
                'function',
                '()',
                // ';',
            ],
            ['function', '()', '{}'],
        ],
    },
    {
        name: 'FunctionDeclaration7 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/FunctionDeclaration7.ts)',
        skip: false,
        codeToParse: `
module M {
   function foo();
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['M', 'foo'], ['M', 'foo'], ['foo']],
        operatorsDesired: [
            [
                'module',
                '{}',
                'function',
                '()',
                // ';'
            ],
            [
                'module',
                '{}',
                'function',
                '()',
                // ';'
            ],
            [
                'function',
                '()',
                // ';'
            ],
        ],
    },
    {
        name: 'InterfaceDeclaration8 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/InterfaceDeclaration8.ts)',
        skip: false,
        codeToParse: `
interface string {
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [[], []],
        operatorsDesired: [
            ['interface', 'string', '{}'],
            ['interface', 'string', '{}'],
        ],
    },
    {
        name: 'MemberAccessorDeclaration15 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/MemberAccessorDeclaration15.ts)',
        skip: false,
        codeToParse: `
class C {
   set Foo(public a: number) { }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['C', 'Foo', 'a'],
            ['C', 'Foo', 'a'],
            ['Foo', 'a'],
        ],
        operatorsDesired: [
            ['class', '{}', 'set', '()', 'public', ':', 'number', '{}'],
            ['class', '{}', 'set', '()', 'public', ':', 'number', '{}'],
            ['set', '()', 'public', ':', 'number', '{}'],
        ],
    },
    {
        name: 'ParameterList13 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList13.ts',
        skip: false,
        codeToParse: `
interface I {
    new (public x);
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['I', 'x'], ['I', 'x'], ['x']],
        operatorsDesired: [
            [
                'interface',
                '{}',
                'new',
                '()',
                'public',
                // ';'
            ],
            [
                'interface',
                '{}',
                'new',
                '()',
                'public',
                // ';'
            ],
            [
                'new',
                '()',
                'public',
                // ';'
            ],
        ],
    },
    {
        name: 'ParameterList4 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList4.ts)',
        skip: false,
        codeToParse: `
function F(public A) {
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['F', 'A'],
            ['F', 'A'],
        ],
        operatorsDesired: [
            ['function', '()', 'public', '{}'],
            ['function', '()', 'public', '{}'],
        ],
    },
    {
        name: 'ParameterList5 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList5.ts)',
        skip: false,
        codeToParse: `
function A(): (public B) => C {
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['A', 'B', 'C'],
            ['A', 'B', 'C'],
        ],
        operatorsDesired: [
            [
                'function',
                '()',
                ':',
                '()',
                'public',
                '=>', // TODO: This token is not coming through - will need deeper
                '{}',
            ],
            [
                'function',
                '()',
                ':',
                '()',
                'public',
                '=>', // TODO: This token is not coming through - will need deeper
                '{}',
            ],
        ],
    },
    {
        name: 'ParameterList6 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList6.ts)',
        skip: false,
        codeToParse: `
class C {
    constructor(C: (public A) => any) {
    }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['C', 'C', 'A'],
            ['C', 'C', 'A'],
            ['C', 'A'],
        ],
        operatorsDesired: [
            ['class', '{}', 'constructor', '()', ':', '()', 'public', '=>', 'any', '{}'],
            ['class', '{}', 'constructor', '()', ':', '()', 'public', '=>', 'any', '{}'],
            ['constructor', '()', ':', '()', 'public', '=>', 'any', '{}'],
        ],
    },
    {
        name: 'ParameterList7 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList7.ts',
        skip: false,
        codeToParse: `
class C1 {
    constructor(public p1:string); // ERROR
    constructor(private p2:number); // ERROR
    constructor(public p3:any) {} // OK
}
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [['C1', 'p1', 'p2', 'p3'], ['C1', 'p1', 'p2', 'p3'], ['p1'], ['p2'], ['p3']],
        operatorsDesired: [
            [
                'class',
                '{}',
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
                'constructor',
                '()',
                'public',
                ':',
                'any',
                '{}',
            ],
            [
                'class',
                '{}',
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
                'constructor',
                '()',
                'public',
                ':',
                'any',
                '{}',
            ],
            [
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
            ],
            [
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
            ],
            ['constructor', '()', 'public', ':', 'any', '{}'],
        ],
    },
    {
        name: 'ParameterList8 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/ParameterList8.ts)',
        skip: false,
        codeToParse: `
declare class C2 {
    constructor(public p1:string); // ERROR
    constructor(private p2:number); // ERROR
    constructor(public p3:any); // ERROR
}
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [['C2', 'p1', 'p2', 'p3'], ['C2', 'p1', 'p2', 'p3'], ['p1'], ['p2'], ['p3']],
        operatorsDesired: [
            [
                'declare',
                'class',
                '{}',
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
                'constructor',
                '()',
                'public',
                ':',
                'any',
                // ';',
            ],
            [
                'declare',
                'class',
                '{}',
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
                'constructor',
                '()',
                'public',
                ':',
                'any',
                // ';',
            ],
            [
                'constructor',
                '()',
                'public',
                ':',
                'string',
                // ';',
            ],
            [
                'constructor',
                '()',
                'private',
                ':',
                'number',
                // ';',
            ],
            [
                'constructor',
                '()',
                'public',
                ':',
                'any',
                // ';',
            ],
        ],
    },
    {
        name: 'SystemModuleForStatementNoInitializer (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/SystemModuleForStatementNoInitializer.ts)',
        skip: false,
        codeToParse: `
//@module: system

export { };

let i = 0;
let limit = 10;

for (; i < limit; ++i) {
    break;
}

for (; ; ++i) {
    break;
}

for (; ;) {
    break;
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['i', '0', 'limit', '10', 'i', 'limit', 'i', 'i']],
        operatorsDesired: [
            [
                'export',
                '{}',
                // ';',
                'let',
                '=',
                // ';',
                'let',
                '=',
                // ';',
                'for',
                '()',
                ';',
                '<',
                ';',
                '++',
                '{}',
                'break',
                // ';',
                'for',
                '()',
                ';',
                ';',
                '++',
                '{}',
                'break',
                // ';',
                'for',
                '()',
                ';',
                ';',
                '{}',
                'break',
                // ';',
            ],
        ],
    },
    {
        name: 'abstractClassInLocalScope (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractClassInLocalScope.ts)',
        skip: false,
        codeToParse: `
(() => {
    abstract class A {}
    class B extends A {}
    new B();
    return A;
})();
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['A', 'B', 'A', 'B', 'A'], ['A'], ['B', 'A']],
        operatorsDesired: [
            [
                '()',
                '()',
                '=>',
                '{}',
                'abstract',
                'class',
                '{}',
                'class',
                'extends',
                '{}',
                'new',
                '()',
                // ';',
                'return',
                // ';',
                '()',
            ],
            ['abstract', 'class', '{}'],
            ['class', 'extends', '{}'],
        ],
    },
    {
        name: 'abstractClassUnionInstantiation (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractClassUnionInstantiation.ts)',
        skip: false,
        codeToParse: `
class ConcreteA {}
class ConcreteB {}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['ConcreteA', 'ConcreteB'], ['ConcreteA'], ['ConcreteB']],
        operatorsDesired: [
            ['class', '{}', 'class', '{}'],
            ['class', '{}'],
            ['class', '{}'],
        ],
    },
    {
        name: 'Abstract Classes',
        skip: false,
        codeToParse: `
abstract class AbstractA { a: string; }
abstract class AbstractB { b: string; }
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [['AbstractA', 'a', 'AbstractB', 'b'], ['AbstractA', 'a'], ['a'], ['AbstractB', 'b'], ['b']],
        operatorsDesired: [
            [
                'abstract',
                'class',
                '{}',
                ':',
                'string',
                // ';',
                'abstract',
                'class',
                '{}',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                'class',
                '{}',
                ':',
                'string',
                // ';',
            ],
            [
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                'class',
                '{}',
                ':',
                'string',
                // ';',
            ],
            [
                ':',
                'string',
                // ';',
            ],
        ],
    },
    {
        name: 'Classes with Union Type',
        skip: false,
        codeToParse: `
type Abstracts = typeof AbstractA | typeof AbstractB;
type Concretes = typeof ConcreteA | typeof ConcreteB;
type ConcretesOrAbstracts = Concretes | Abstracts;
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            [
                'Abstracts',
                'AbstractA',
                'AbstractB',
                'Concretes',
                'ConcreteA',
                'ConcreteB',
                'ConcretesOrAbstracts',
                'Concretes',
                'Abstracts',
            ],
            ['Abstracts', 'AbstractA', 'AbstractB'],
            ['Concretes', 'ConcreteA', 'ConcreteB'],
            ['ConcretesOrAbstracts', 'Concretes', 'Abstracts'],
        ],
        operatorsDesired: [
            [
                'type',
                '=',
                'typeof',
                '|',
                'typeof',
                // ';',
                'type',
                '=',
                'typeof',
                '|',
                'typeof',
                // ';',
                'type',
                '=',
                '|',
                // ';',
            ],
            [
                'type',
                '=',
                'typeof',
                '|',
                'typeof',
                // ';',
            ],
            [
                'type',
                '=',
                'typeof',
                '|',
                'typeof',
                // ';',
            ],
            [
                'type',
                '=',
                '|',
                // ';',
            ],
        ],
    },
    {
        name: 'Const implementations of Class',
        skip: false,
        codeToParse: `
declare const cls1: ConcretesOrAbstracts;
declare const cls2: Abstracts;
declare const cls3: Concretes;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['cls1', 'ConcretesOrAbstracts', 'cls2', 'Abstracts', 'cls3', 'Concretes']],
        operatorsDesired: [
            [
                'declare',
                'const',
                ':',
                // ';',
                'declare',
                'const',
                ':',
                // ';',
                'declare',
                'const',
                ':',
                // ';',
            ],
        ],
    },
    {
        name: 'Instation of new classes',
        skip: false,
        codeToParse: `
new cls1(); // should error
new cls2(); // should error
new cls3(); // should work
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['cls1', 'cls2', 'cls3']],
        operatorsDesired: [
            [
                'new',
                '()',
                // ';',
                'new',
                '()',
                // ';',
                'new',
                '()',
                // ';',
            ],
        ],
    },
    {
        name: 'Array mapping with Arrow Functions',
        skip: true, // Skipping due to error below
        codeToParse: `
[ConcreteA, AbstractA, AbstractB].map(cls => new cls()); // should error
[ConcreteA, ConcreteB].map(cls => new cls()); // should work
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            ['ConcreteA', 'AbstractA', 'AbstractB', 'map', 'cls', 'cls', 'ConcreteA', 'ConcreteB', 'map', 'cls', 'cls'],
        ],
        operatorsDesired: [
            [
                '[]',
                ',',
                ',',
                '.',
                '()',
                // '()', // TODO: This shows up, but is erroneous - skipping this test
                '=>',
                'new',
                '()',
                // ';'
                '[]',
                ',',
                '.',
                '()',
                // '()', // TODO: This shows up, but is erroneous - skipping this test
                '=>',
                'new',
                '()',
                // ';'
            ],
        ],
    },
    {
        name: 'abstractIdentifierNameStrict (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractIdentifierNameStrict.ts)',
        skip: false,
        codeToParse: `
var abstract = true;

function foo() {
    "use strict";
    var abstract = true;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['foo', '"use strict"'],
            ['foo', '"use strict"'],
        ],
        operatorsDesired: [
            [
                'var',
                'abstract',
                '=',
                'true',
                // ';',
                'function',
                '()',
                '{}',
                'var',
                'abstract',
                '=',
                'true',
                // ';'
            ],
            [
                'function',
                '()',
                '{}',
                'var',
                'abstract',
                '=',
                'true',
                // ';'
            ],
        ],
    },
    {
        name: 'abstractInterfaceIdentifierName (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractInterfaceIdentifierName.ts)',
        skip: false,
        codeToParse: `
interface abstract {
    abstract(): void;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [[], [], []],
        operatorsDesired: [
            [
                'interface',
                'abstract',
                '{}',
                'abstract',
                '()',
                ':',
                'void',
                // ';'
            ],
            [
                'interface',
                'abstract',
                '{}',
                'abstract',
                '()',
                ':',
                'void',
                // ';'
            ],
            [
                'abstract',
                '()',
                ':',
                'void',
                // ';'
            ],
        ],
    },
    {
        name: 'abstractPropertyBasics (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractPropertyBasics.ts)',
        skip: false,
        codeToParse: `
abstract class B implements A {
    abstract prop: string;
    abstract readonly ro: string;
    abstract get readonlyProp(): string;
    abstract set readonlyProp(val: string);
    abstract m(): void;
}
        `,
        numItemsInHeirarchy: 7,
        operandsDesired: [
            ['B', 'A', 'prop', 'ro', 'readonlyProp', 'readonlyProp', 'val', 'm'],
            ['B', 'A', 'prop', 'ro', 'readonlyProp', 'readonlyProp', 'val', 'm'],
            ['prop'],
            ['ro'],
            ['readonlyProp'],
            ['readonlyProp', 'val'],
            ['m'],
        ],
        operatorsDesired: [
            [
                'abstract',
                'class',
                'implements',
                '{}',
                'abstract',
                ':',
                'string',
                // ';',
                'abstract',
                'readonly',
                ':',
                'string',
                // ';',
                'abstract',
                'get',
                '()',
                ':',
                'string',
                // ';',
                'abstract',
                'set',
                '()',
                ':',
                'string',
                // ';',
                'abstract',
                '()',
                ':',
                'void',
                // ';',
            ],
            [
                'abstract',
                'class',
                'implements',
                '{}',
                'abstract',
                ':',
                'string',
                // ';',
                'abstract',
                'readonly',
                ':',
                'string',
                // ';',
                'abstract',
                'get',
                '()',
                ':',
                'string',
                // ';',
                'abstract',
                'set',
                '()',
                ':',
                'string',
                // ';',
                'abstract',
                '()',
                ':',
                'void',
                // ';',
            ],
            [
                'abstract',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                'readonly',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                'get',
                '()',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                'set',
                '()',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                '()',
                ':',
                'void',
                // ';',
            ],
        ],
    },
    {
        name: 'abstractPropertyInConstructor (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractPropertyInConstructor.ts)',
        skip: false,
        codeToParse: `
abstract class DerivedAbstractClass extends AbstractClass {
    cb = (s: string) => {};

    constructor(str: string, other: AbstractClass, yetAnother: DerivedAbstractClass) {
        super(str, other);
        // there is no implementation of 'prop' in any base class
        this.cb(this.prop.toLowerCase());
    }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            [
                'DerivedAbstractClass',
                'AbstractClass',
                'cb',
                's',
                'str',
                'other',
                'AbstractClass',
                'yetAnother',
                'DerivedAbstractClass',
                'str',
                'other',
                'cb',
                'prop',
                'toLowerCase',
            ],
            [
                'DerivedAbstractClass',
                'AbstractClass',
                'cb',
                's',
                'str',
                'other',
                'AbstractClass',
                'yetAnother',
                'DerivedAbstractClass',
                'str',
                'other',
                'cb',
                'prop',
                'toLowerCase',
            ],
            ['cb', 's'],
            [
                'str',
                'other',
                'AbstractClass',
                'yetAnother',
                'DerivedAbstractClass',
                'str',
                'other',
                'cb',
                'prop',
                'toLowerCase',
            ],
        ],
        operatorsDesired: [
            [
                'abstract',
                'class',
                'extends',
                '{}',
                '=',
                '()',
                ':',
                'string',
                '=>',
                '{}',
                'constructor',
                '()',
                ':',
                'string',
                ',',
                ':',
                ',',
                ':',
                '{}',
                'super',
                '()',
                ',',
                'this',
                '.',
                '()',
                'this',
                '.',
                '.',
                '()',
            ],
            [
                'abstract',
                'class',
                'extends',
                '{}',
                '=',
                '()',
                ':',
                'string',
                '=>',
                '{}',
                'constructor',
                '()',
                ':',
                'string',
                ',',
                ':',
                ',',
                ':',
                '{}',
                'super',
                '()',
                ',',
                'this',
                '.',
                '()',
                'this',
                '.',
                '.',
                '()',
            ],
            ['=', '()', ':', 'string', '=>', '{}'],
            [
                'constructor',
                '()',
                ':',
                'string',
                ',',
                ':',
                ',',
                ':',
                '{}',
                'super',
                '()',
                ',',
                'this',
                '.',
                '()',
                'this',
                '.',
                '.',
                '()',
            ],
        ],
    },
    {
        name: 'Abstract Properties and Constructor with Type & This assignments + named parameters',
        skip: false,
        codeToParse: `
abstract class C1 {
    abstract x: string;
    abstract y: string;

    constructor() {
        let self = this;                // ok
        let { x, y: y1 } = this;        // error
        ({ x, y: y1, "y": y1 } = this); // error
    }
}
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [
            ['C1', 'x', 'y', 'self', 'x', 'y', 'y1', 'x', 'y', 'y1', '"y"', 'y1'],
            ['C1', 'x', 'y', 'self', 'x', 'y', 'y1', 'x', 'y', 'y1', '"y"', 'y1'],
            ['x'],
            ['y'],
            ['self', 'x', 'y', 'y1', 'x', 'y', 'y1', '"y"', 'y1'],
        ],
        operatorsDesired: [
            [
                'abstract',
                'class',
                '{}',
                'abstract',
                ':',
                'string',
                'abstract',
                ':',
                'string',
                'constructor',
                '()',
                '{}',
                'let',
                '=',
                // ';',
                'this',
                'let',
                '{}',
                ',',
                ':',
                '=',
                'this',
                // ';',
                '()',
                '{}',
                ',',
                ':',
                ',',
                ':',
                '=',
                'this',
                // ';',
            ],
            [
                'abstract',
                'class',
                '{}',
                'abstract',
                ':',
                'string',
                'abstract',
                ':',
                'string',
                'constructor',
                '()',
                '{}',
                'let',
                '=',
                // ';',
                'this',
                'let',
                '{}',
                ',',
                ':',
                '=',
                'this',
                // ';',
                '()',
                '{}',
                ',',
                ':',
                ',',
                ':',
                '=',
                'this',
                // ';',
            ],
            [
                'abstract',
                ':',
                'string',
                // ';',
            ],
            [
                'abstract',
                ':',
                'string',
                // ';',
            ],
            [
                'constructor',
                '()',
                '{}',
                'let',
                '=',
                // ';',
                'this',
                'let',
                '{}',
                ',',
                ':',
                '=',
                'this',
                // ';',
                '()',
                '{}',
                ',',
                ':',
                ',',
                ':',
                '=',
                'this',
                // ';',
            ],
        ],
    },
    {
        name: 'abstractPropertyNegative (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/abstractPropertyNegative.ts)',
        skip: false,
        codeToParse: `
class WrongTypeAccessorImpl extends WrongTypeAccessor {
    get num() { return "nope, wrong"; }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['WrongTypeAccessorImpl', 'WrongTypeAccessor', 'num', '"nope, wrong"'],
            ['WrongTypeAccessorImpl', 'WrongTypeAccessor', 'num', '"nope, wrong"'],
            ['num', '"nope, wrong"'],
        ],
        operatorsDesired: [
            [
                'class',
                'extends',
                '{}',
                'get',
                '()',
                '{}',
                'return',
                // ';'
            ],
            [
                'class',
                'extends',
                '{}',
                'get',
                '()',
                '{}',
                'return',
                // ';'
            ],
            [
                'get',
                '()',
                '{}',
                'return',
                // ';'
            ],
        ],
    },
    {
        name: 'acceptableAlias1 (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/acceptableAlias1.ts)',
        skip: false,
        codeToParse: `
module M {
    export module N {
    }
    export import X = N;
}

import r = M.X;
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['M', 'N', 'X', 'N', 'r', 'M', 'X'], ['M', 'N', 'X', 'N'], ['N']],
        operatorsDesired: [
            [
                'module',
                '{}',
                'export',
                'module',
                '{}',
                'export',
                'import',
                '=',
                // ';'
                'import',
                '=',
                '.',
                // ';',
            ],
            [
                'module',
                '{}',
                'export',
                'module',
                '{}',
                'export',
                'import',
                '=',
                // ';'
            ],
            ['export', 'module', '{}'],
        ],
    },
    {
        name: 'accessorBodyInTypeContext (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorBodyInTypeContext.ts)',
        skip: false,
        codeToParse: `
type A = {
    get foo() { return 0 }
};

type B = {
    set foo(v: any) { }
};
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [
            ['A', 'foo', '0', 'B', 'foo', 'v'],
            ['A', 'foo', '0'],
            ['foo', '0'],
            ['B', 'foo', 'v'],
            ['foo', 'v'],
        ],
        operatorsDesired: [
            ['type', '=', '{}', 'get', '()', '{}', 'return', 'type', '=', '{}', 'set', '()', ':', 'any', '{}'],
            ['type', '=', '{}', 'get', '()', '{}', 'return'],
            ['get', '()', '{}', 'return'],
            ['type', '=', '{}', 'set', '()', ':', 'any', '{}'],
            ['set', '()', ':', 'any', '{}'],
        ],
    },
    {
        name: 'accessDeclarationOrder [incl privateIdentifier] (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorDeclarationOrder.ts)',
        skip: false,
        codeToParse: `
class C1 {
    #name: string;

    public get name() {
        return this.#name;
    }

    private set name(name: string) {
        this.#name = name;
    }
}
        `,
        numItemsInHeirarchy: 5,
        operandsDesired: [
            ['C1', '#name', 'name', '#name', 'name', 'name', '#name', 'name'],
            ['C1', '#name', 'name', '#name', 'name', 'name', '#name', 'name'],
            ['#name'],
            ['name', '#name'],
            ['name', 'name', '#name', 'name'],
        ],
        operatorsDesired: [
            [
                'class',
                '{}',
                ':',
                'string',
                'public',
                'get',
                '()',
                '{}',
                'return',
                'this',
                '.',
                'private',
                'set',
                '()',
                ':',
                'string',
                '{}',
                'this',
                '.',
                '=',
            ],
            [
                'class',
                '{}',
                ':',
                'string',
                'public',
                'get',
                '()',
                '{}',
                'return',
                'this',
                '.',
                'private',
                'set',
                '()',
                ':',
                'string',
                '{}',
                'this',
                '.',
                '=',
            ],
            [':', 'string'],
            ['public', 'get', '()', '{}', 'return', 'this', '.'],
            ['private', 'set', '()', ':', 'string', '{}', 'this', '.', '='],
        ],
    },
    {
        name: 'accessorParameterAccessibilityModifier (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorParameterAccessibilityModifier.ts)',
        skip: false,
        codeToParse: `
class C {
    set X(public v) { }
    static set X(public v2) { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['C', 'X', 'v', 'X', 'v2'],
            ['C', 'X', 'v', 'X', 'v2'],
            ['X', 'v'],
            ['X', 'v2'],
        ],
        operatorsDesired: [
            ['class', '{}', 'set', '()', 'public', '{}', 'static', 'set', '()', 'public', '{}'],
            ['class', '{}', 'set', '()', 'public', '{}', 'static', 'set', '()', 'public', '{}'],
            ['set', '()', 'public', '{}'],
            ['static', 'set', '()', 'public', '{}'],
        ],
    },
    {
        name: 'accessorWithInitializer (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorWithInitializer.ts)',
        skip: false,
        codeToParse: `
class C {
    set X(v = 0) { }
    static set X(v2 = 0) { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['C', 'X', 'v', '0', 'X', 'v2', '0'],
            ['C', 'X', 'v', '0', 'X', 'v2', '0'],
            ['X', 'v', '0'],
            ['X', 'v2', '0'],
        ],
        operatorsDesired: [
            ['class', '{}', 'set', '()', '=', '{}', 'static', 'set', '()', '=', '{}'],
            ['class', '{}', 'set', '()', '=', '{}', 'static', 'set', '()', '=', '{}'],
            ['set', '()', '=', '{}'],
            ['static', 'set', '()', '=', '{}'],
        ],
    },
    {
        name: 'accessorWithLineTerminator (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorWithLineTerminator.ts)',
        skip: false,
        codeToParse: `
class C {
    get
    x() { return 1 }

    set
    x(v) {  }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['C', 'x', '1', 'x', 'v'],
            ['C', 'x', '1', 'x', 'v'],
            ['x', '1'],
            ['x', 'v'],
        ],
        operatorsDesired: [
            ['class', '{}', 'get', '()', '{}', 'return', 'set', '()', '{}'],
            ['class', '{}', 'get', '()', '{}', 'return', 'set', '()', '{}'],
            ['get', '()', '{}', 'return'],
            ['set', '()', '{}'],
        ],
    },
    {
        name: 'accessorWithRestParam (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorWithRestParam.ts)',
        skip: false,
        codeToParse: `
class C {
    set X(...v) { }
    static set X(...v2) { }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['C', 'X', 'v', 'X', 'v2'],
            ['C', 'X', 'v', 'X', 'v2'],
            ['X', 'v'],
            ['X', 'v2'],
        ],
        operatorsDesired: [
            ['class', '{}', 'set', '()', '...', '{}', 'static', 'set', '()', '...', '{}'],
            ['class', '{}', 'set', '()', '...', '{}', 'static', 'set', '()', '...', '{}'],
            ['set', '()', '...', '{}'],
            ['static', 'set', '()', '...', '{}'],
        ],
    },
    {
        name: 'accessorsEmit (https://github.com/microsoft/TypeScript/blob/main/tests/cases/compiler/accessorsEmit.ts)',
        skip: false,
        codeToParse: `
class Test {
    get Property(): Result {
        var x = 1;
        return null;
    }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['Test', 'Property', 'Result', 'x', '1'],
            ['Test', 'Property', 'Result', 'x', '1'],
            ['Property', 'Result', 'x', '1'],
        ],
        operatorsDesired: [
            ['class', '{}', 'get', '()', ':', '{}', 'var', '=', 'return', 'null'],
            ['class', '{}', 'get', '()', ':', '{}', 'var', '=', 'return', 'null'],
            ['get', '()', ':', '{}', 'var', '=', 'return', 'null'],
        ],
    },
    {
        name: 'Interface with function, and function that involves parameters',
        skip: false,
        codeToParse: `
interface Foo {
    (): string;
}

interface Bar extends Foo {
    (key: string): string;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['Foo', 'Bar', 'Foo', 'key'], ['Foo'], ['Bar', 'Foo', 'key']],
        operatorsDesired: [
            ['interface', '{}', '()', ':', 'string', 'interface', 'extends', '{}', '()', ':', 'string', ':', 'string'],
            ['interface', '{}', '()', ':', 'string'],
            ['interface', 'extends', '{}', '()', ':', 'string', ':', 'string'],
        ],
    },
    {
        name: 'asyncAwaitWithCapturedBlockScopeVar (https://github.com/microsoft/TypeScript/blob/77374732df82c9d5c1319677dc595868bbc648b5/tests/cases/compiler/asyncAwaitWithCapturedBlockScopeVar.ts)',
        skip: false,
        codeToParse: `
async function fn1() {
    let ar = [];
    for (let i = 0; i < 1; i++) {
        await 1;
        ar.push(() => i);
    }
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['fn1', 'ar', 'i', '0', 'i', '1', 'i', '1', 'ar', 'push', 'i'],
            ['fn1', 'ar', 'i', '0', 'i', '1', 'i', '1', 'ar', 'push', 'i'],
        ],
        operatorsDesired: [
            [
                'async',
                'function',
                '()',
                '{}',
                'let',
                '=',
                '[]',
                'for',
                '()',
                'let',
                '=',
                ';',
                '<',
                ';',
                '++',
                '{}',
                'await',
                '.',
                '()',
                '()',
                '=>',
            ],
            [
                'async',
                'function',
                '()',
                '{}',
                'let',
                '=',
                '[]',
                'for',
                '()',
                'let',
                '=',
                ';',
                '<',
                ';',
                '++',
                '{}',
                'await',
                '.',
                '()',
                '()',
                '=>',
            ],
        ],
    },
    {
        name: 'computedPropertyName (https://github.com/microsoft/TypeScript/blob/77374732df82c9d5c1319677dc595868bbc648b5/tests/cases/conformance/externalModules/typeOnly/computedPropertyName.ts)',
        skip: false,
        codeToParse: `
interface Component {
  [onInit]?(): void;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['Component', 'onInit'], ['Component', 'onInit'], ['onInit']],
        operatorsDesired: [
            ['interface', '{}', '[]', '?', '()', ':', 'void'],
            ['interface', '{}', '[]', '?', '()', ':', 'void'],
            ['[]', '?', '()', ':', 'void'],
        ],
    },
    {
        name: 'optionalPropertySignature',
        skip: false,
        codeToParse: `
interface UserAccount {
  id: number;
  email?: string;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['UserAccount', 'id', 'email'],
            ['UserAccount', 'id', 'email'],
        ],
        operatorsDesired: [
            ['interface', '{}', ':', 'number', '?', ':', 'string'],
            ['interface', '{}', ':', 'number', '?', ':', 'string'],
        ],
    },
    {
        name: 'classStaticBlockDeclaration',
        skip: false,
        codeToParse: `
class Unicorn {
  static #isShiny = false;
  static #shinyLevel = 0;

  static {
    const { hasRainbowHorn, hasRainbowTail } = getData(Unicorn);
    }
  }
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['Unicorn', '#isShiny', '#shinyLevel', '0', 'hasRainbowHorn', 'hasRainbowTail', 'getData', 'Unicorn'],
            ['Unicorn', '#isShiny', '#shinyLevel', '0', 'hasRainbowHorn', 'hasRainbowTail', 'getData', 'Unicorn'],
            ['#isShiny'],
            ['#shinyLevel', '0'],
        ],
        operatorsDesired: [
            ['class', '{}', 'static', '=', 'false', 'static', '=', 'static', '{}', 'const', '{}', ',', '=', '()'],
            ['class', '{}', 'static', '=', 'false', 'static', '=', 'static', '{}', 'const', '{}', ',', '=', '()'],
            ['static', '=', 'false'],
            ['static', '='],
        ],
    },
    {
        name: 'Export Named Typed with Union',
        skip: false,
        codeToParse: `
export type DashboardLinkType = 'link' | 'dashboards';
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['DashboardLinkType', '"link"', '"dashboards"'],
            ['DashboardLinkType', '"link"', '"dashboards"'],
        ],
        operatorsDesired: [
            ['export', 'type', '=', '|'],
            ['export', 'type', '=', '|'],
        ],
    },
    {
        name: 'Class expension and static var with Array type parameter',
        skip: false,
        codeToParse: `
export class DashboardModel implements TimeModel {
  id: any;

  static nonPersistedProperties: { [str: string]: boolean } = {
    events: true,
  };
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            ['DashboardModel', 'TimeModel', 'id', 'nonPersistedProperties', 'str', 'events'],
            ['DashboardModel', 'TimeModel', 'id', 'nonPersistedProperties', 'str', 'events'],
            ['id'],
            ['nonPersistedProperties', 'str', 'events'],
        ],
        operatorsDesired: [
            [
                'export',
                'class',
                'implements',
                '{}',
                ':',
                'any',
                'static',
                ':',
                '{}',
                '[]',
                ':',
                'string',
                ':',
                'boolean',
                '=',
                '{}',
                ':',
                'true',
            ],
            [
                'export',
                'class',
                'implements',
                '{}',
                ':',
                'any',
                'static',
                ':',
                '{}',
                '[]',
                ':',
                'string',
                ':',
                'boolean',
                '=',
                '{}',
                ':',
                'true',
            ],
            [':', 'any'],
            ['static', ':', '{}', '[]', ':', 'string', ':', 'boolean', '=', '{}', ':', 'true'],
        ],
    },
    {
        name: 'for-in statement',
        skip: false,
        codeToParse: `
    for (const property in this) {
        console.log(property)
    }
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['property', 'console', 'log', 'property']],
        operatorsDesired: [['for', '()', 'const', 'in', 'this', '{}', '.', '()']],
    },
    {
        name: 'delete expression',
        skip: false,
        codeToParse: `
delete model.scopedVars;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['model', 'scopedVars']],
        operatorsDesired: [['delete', '.']],
    },
    {
        name: 'intersection type node',
        skip: false,
        codeToParse: `
export class DashboardModel implements TimeModel {
    private updateTemplatingSaveModelClone(
        copy: any,
        defaults: { saveTimerange: boolean; saveVariables: boolean } & CloneOptions
    ) {}
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            [
                'DashboardModel',
                'TimeModel',
                'updateTemplatingSaveModelClone',
                'copy',
                'defaults',
                'saveTimerange',
                'saveVariables',
                'CloneOptions',
            ],
            [
                'DashboardModel',
                'TimeModel',
                'updateTemplatingSaveModelClone',
                'copy',
                'defaults',
                'saveTimerange',
                'saveVariables',
                'CloneOptions',
            ],
            ['updateTemplatingSaveModelClone', 'copy', 'defaults', 'saveTimerange', 'saveVariables', 'CloneOptions'],
        ],
        operatorsDesired: [
            [
                'export',
                'class',
                'implements',
                '{}',
                'private',
                '()',
                ':',
                'any',
                ',',
                ':',
                '{}',
                ':',
                'boolean',
                ',',
                ':',
                'boolean',
                '&',
                '{}',
            ],
            [
                'export',
                'class',
                'implements',
                '{}',
                'private',
                '()',
                ':',
                'any',
                ',',
                ':',
                '{}',
                ':',
                'boolean',
                ',',
                ':',
                'boolean',
                '&',
                '{}',
            ],
            ['private', '()', ':', 'any', ',', ':', '{}', ':', 'boolean', ',', ':', 'boolean', '&', '{}'],
        ],
    },
    {
        name: 'for-of statement',
        skip: false,
        codeToParse: `
for (const current of copy.templating.list) {
    console.log(current);
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['current', 'copy', 'templating', 'list', 'console', 'log', 'current']],
        operatorsDesired: [['for', '()', 'const', 'of', '.', '.', '{}', '.', '()']],
    },
    {
        name: 'nonNull Expression',
        skip: false,
        codeToParse: `
function foo(maxPos: Position) {
    return maxPos!.y;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['foo', 'maxPos', 'Position', 'maxPos', 'y'],
            ['foo', 'maxPos', 'Position', 'maxPos', 'y'],
        ],
        operatorsDesired: [
            ['function', '()', ':', '{}', 'return', '!', '.'],
            ['function', '()', ':', '{}', 'return', '!', '.'],
        ],
    },
    {
        name: 'element access expression',
        skip: false,
        codeToParse: `
if (DashboardModel.nonPersistedProperties[property] || !this.hasOwnProperty(property)) {
    continue;
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['DashboardModel', 'nonPersistedProperties', 'property', 'hasOwnProperty', 'property']],
        operatorsDesired: [['if', '()', '.', '[]', '||', '!', 'this', '.', '()', '{}', 'continue']],
    },
    {
        name: 'Spread Operator',
        skip: false,
        codeToParse: `
pull(this.panels, ...panelsToRemove);
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['pull', 'panels', 'panelsToRemove']],
        operatorsDesired: [['()', 'this', '.', ',', '...']],
    },
    {
        name: 'visit conditional expression',
        skip: false,
        codeToParse: `
panelIndex >= 0 ? { panel: this.panels[panelIndex], index: panelIndex } : null;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['panelIndex', '0', 'panel', 'panels', 'panelIndex', 'index', 'panelIndex']],
        operatorsDesired: [['>=', '?', '{}', ':', 'this', '.', '[]', ',', ':', ':', 'null']],
    },
    {
        name: 'Ternary Expression',
        skip: false,
        codeToParse: `
(this.timezone ? this.timezone : contextSrv?.user?.timezone) as TimeZone
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['timezone', 'timezone', 'contextSrv', 'user', 'timezone', 'TimeZone']],
        operatorsDesired: [['()', 'this', '.', '?', 'this', '.', ':', '?', '.', '?', '.', 'as']],
    },
    {
        name: 'Type Predicate',
        skip: false,
        codeToParse: `
function isPanelWithLegend(panel: PanelModel): panel is PanelModel & Pick<Required<PanelModel>, 'legend'> {
    return Boolean(panel.legend);
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            [
                'isPanelWithLegend',
                'panel',
                'PanelModel',
                'panel',
                'PanelModel',
                'Pick',
                'Required',
                'PanelModel',
                '"legend"',
                'Boolean',
                'panel',
                'legend',
            ],
            [
                'isPanelWithLegend',
                'panel',
                'PanelModel',
                'panel',
                'PanelModel',
                'Pick',
                'Required',
                'PanelModel',
                '"legend"',
                'Boolean',
                'panel',
                'legend',
            ],
        ],
        operatorsDesired: [
            ['function', '()', ':', ':', 'is', '&', '<>', '<>', ',', '{}', 'return', '()', '.'],
            ['function', '()', ':', ':', 'is', '&', '<>', '<>', ',', '{}', 'return', '()', '.'],
        ],
    },
    {
        name: 'while loop',
        skip: false,
        codeToParse: `
let i: number = 2;

while (i < 4) {
    console.log( "Block statement execution no." + i )
    i++;
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['i', '2', 'i', '4', 'console', 'log', '"Block statement execution no."', 'i', 'i']],
        operatorsDesired: [['let', ':', 'number', '=', 'while', '()', '<', '{}', '.', '()', '+', '++']],
    },
    {
        name: 'Indexed Access Type',
        skip: false,
        codeToParse: `
!item.keyInfo && (item.keyInfo = {} as MappingResultItem['keyInfo']);
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['item', 'keyInfo', 'item', 'keyInfo', 'MappingResultItem', '"keyInfo"']],
        operatorsDesired: [['!', '.', '&&', '()', '.', '=', '{}', 'as', '[]']],
    },
    {
        name: 'Do-While',
        skip: false,
        codeToParse: `
do {
    keyInfo.id = '\0' + keyInfo.name + '\0' + idNum++;
} while (idMap.get(keyInfo.id));
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            ['keyInfo', 'id', '"\u0000"', 'keyInfo', 'name', '"\u0000"', 'idNum', 'idMap', 'keyInfo', 'id'],
        ],
        operatorsDesired: [['do', '{}', '.', '=', '+', '.', '+', '+', '++', 'while', '()', '.', 'get', '()', '.']],
    },
    {
        name: 'Throw',
        skip: false,
        codeToParse: `
throw new Error();
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['Error']],
        operatorsDesired: [['throw', 'new', '()']],
    },
    {
        name: 'Tuple Type',
        skip: false,
        codeToParse: `
export function compressBatches(batchA: BatchItem[], batchB: BatchItem[]): [BatchItem[], BatchItem[]] {}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['compressBatches', 'batchA', 'BatchItem', 'batchB', 'BatchItem', 'BatchItem', 'BatchItem'],
            ['compressBatches', 'batchA', 'BatchItem', 'batchB', 'BatchItem', 'BatchItem', 'BatchItem'],
        ],
        operatorsDesired: [
            ['export', 'function', '()', ':', '[]', ',', ':', '[]', ':', '[]', '[]', ',', '[]', '{}'],
            ['export', 'function', '()', ':', '[]', ',', ':', '[]', ':', '[]', '[]', ',', '[]', '{}'],
        ],
    },
    {
        name: 'Regular Expression',
        skip: false,
        codeToParse: `
const parsedKey = key.match(/^(\w+)(Index|Id|Name)$/) || [];
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['parsedKey', 'key', 'match', '/^(w+)(Index|Id|Name)$/']],
        operatorsDesired: [['const', '=', '.', '()', '||', '[]']],
    },
    {
        name: 'Type Operator Node',
        skip: false,
        codeToParse: `
const queryType = (parsedKey[2] || '').toLowerCase() as keyof QueryReferringUserOption;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['queryType', 'parsedKey', '2', '""', 'toLowerCase', 'QueryReferringUserOption']],
        operatorsDesired: [['const', '=', '()', '[]', '||', '.', '()', 'as', 'keyof']],
    },
    {
        name: 'Parenthesized Type',
        skip: false,
        codeToParse: `
const leftArr = sourceValue as (string | number)[];
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['leftArr', 'sourceValue']],
        operatorsDesired: [['const', '=', 'as', '()', 'string', '|', 'number', '[]']],
    },
    {
        name: 'Semicolon Class Element',
        skip: false,
        codeToParse: `
class Foo {
    private _buildTree() {};
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [['Foo', '_buildTree'], ['Foo', '_buildTree'], ['_buildTree']],
        operatorsDesired: [
            ['class', '{}', 'private', '()', '{}', ';'],
            ['class', '{}', 'private', '()', '{}', ';'],
            ['private', '()', '{}'],
        ],
    },
    {
        name: 'Switch Case (w/Default) Statement',
        skip: false,
        codeToParse: `
switch (positionInfo.left || positionInfo.right) {
    case 'center':
        left = 1;
        break;
    case 'right':
        left = 2;
        break;
    default:
        left = 3;
        break;
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'positionInfo',
                'left',
                'positionInfo',
                'right',
                '"center"',
                'left',
                '1',
                '"right"',
                'left',
                '2',
                'left',
                '3',
            ],
        ],
        operatorsDesired: [
            [
                'switch',
                '()',
                '.',
                '||',
                '.',
                '{}',
                'case',
                ':',
                '=',
                'break',
                'case',
                ':',
                '=',
                'break',
                'default',
                ':',
                '=',
                'break',
            ],
        ],
    },
    {
        name: 'Typeof Expression',
        skip: false,
        codeToParse: `
const hasWindow = typeof window !== 'undefined';
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['hasWindow', 'window', '"undefined"']],
        operatorsDesired: [['const', '=', 'typeof', '!===']],
    },
    {
        name: 'Empty Statement',
        skip: false,
        codeToParse: `
export interface SetOptionOpts {
    notMerge?: boolean;
};
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['SetOptionOpts', 'notMerge'],
            ['SetOptionOpts', 'notMerge'],
        ],
        operatorsDesired: [
            ['export', 'interface', '{}', '?', ':', 'boolean', ';'],
            ['export', 'interface', '{}', '?', ':', 'boolean'],
        ],
    },
    {
        name: 'Mapped Type',
        skip: false,
        codeToParse: `
type ECEventDefinition = {
    [key in ZRElementEventName]: EventCallbackSingleParam<ECElementEvent>
} & {
    [key: string]: (...args: unknown[]) => void | boolean
};
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            [
                'ECEventDefinition',
                'key',
                'ZRElementEventName',
                'EventCallbackSingleParam',
                'ECElementEvent',
                'key',
                'args',
            ],
            [
                'ECEventDefinition',
                'key',
                'ZRElementEventName',
                'EventCallbackSingleParam',
                'ECElementEvent',
                'key',
                'args',
            ],
        ],
        operatorsDesired: [
            [
                'type',
                '=',
                '{}',
                '[]',
                'in',
                ':',
                '<>',
                '&',
                '{}',
                '[]',
                ':',
                'string',
                ':',
                '()',
                '...',
                ':',
                'unknown',
                '[]',
                '=>',
                'void',
                '|',
                'boolean',
            ],
            [
                'type',
                '=',
                '{}',
                '[]',
                'in',
                ':',
                '<>',
                '&',
                '{}',
                '[]',
                ':',
                'string',
                ':',
                '()',
                '...',
                ':',
                'unknown',
                '[]',
                '=>',
                'void',
                '|',
                'boolean',
            ],
        ],
    },
    {
        name: 'Labeled Statement',
        skip: false,
        codeToParse: `
_throttledZrFlush: false ? R : never;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['_throttledZrFlush', 'R']],
        operatorsDesired: [[':', 'false', '?', ':', 'never']],
    },
    {
        name: 'Conditional Type',
        skip: false,
        codeToParse: `
class ECharts extends Eventful<ECEventDefinition> {
    private _throttledZrFlush: zrender.ZRenderType extends {flush: infer R} ? R : never;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            [
                'ECharts',
                'Eventful',
                'ECEventDefinition',
                '_throttledZrFlush',
                'zrender',
                'ZRenderType',
                'flush',
                'R',
                'R',
            ],
            [
                'ECharts',
                'Eventful',
                'ECEventDefinition',
                '_throttledZrFlush',
                'zrender',
                'ZRenderType',
                'flush',
                'R',
                'R',
            ],
            ['_throttledZrFlush', 'zrender', 'ZRenderType', 'flush', 'R', 'R'],
        ],
        operatorsDesired: [
            ['class', 'extends', '<>', '{}', 'private', ':', '.', 'extends', '{}', ':', 'infer', '?', ':', 'never'],
            ['class', 'extends', '<>', '{}', 'private', ':', '.', 'extends', '{}', ':', 'infer', '?', ':', 'never'],
            ['private', ':', '.', 'extends', '{}', ':', 'infer', '?', ':', 'never'],
        ],
    },
    {
        name: 'Try-Catch',
        skip: false,
        codeToParse: `
try {
    prepare(this);
}
catch (e) {
    throw e;
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['prepare', 'e', 'e']],
        operatorsDesired: [['try', '{}', '()', 'this', 'catch', '()', '{}', 'throw']],
    },
    {
        name: 'Class Expression',
        skip: false,
        codeToParse: `
createExtensionAPI = function (ecIns: ECharts): ExtensionAPI {
    return new (class extends ExtensionAPI {})
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['createExtensionAPI', 'ecIns', 'ECharts', 'ExtensionAPI', 'ExtensionAPI']],
        operatorsDesired: [['=', 'function', '()', ':', ':', '{}', 'return', 'new', '()', 'class', 'extends', '{}']],
    },
    {
        name: 'Named Exports',
        skip: false,
        codeToParse: `
export {registerLayout, registerVisual};
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['registerLayout', 'registerVisual']],
        operatorsDesired: [['export', '{}', ',']],
    },
    {
        name: 'This Type',
        skip: false,
        codeToParse: `
class foo {
    rawr(a: string): this;
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['foo', 'rawr', 'a'],
            ['foo', 'rawr', 'a'],
            ['rawr', 'a'],
        ],
        operatorsDesired: [
            ['class', '{}', '()', ':', 'string', ':', 'this'],
            ['class', '{}', '()', ':', 'string', ':', 'this'],
            ['()', ':', 'string', ':', 'this'],
        ],
    },
    {
        name: 'Import Clause',
        skip: false,
        codeToParse: `
import { ZipCodeValidator } from "./ZipCodeValidator";
import { ZipCodeValidator as ZCV } from "./ZipCodeValidator1";
import * as validator from "./ZipCodeValidator2";
import "./my-module.js";
import { APIResponseType } from "./api";
import type { APIResponseType1 } from "./api1";
import { getResponse, type APIResponseType2} from "./api2";
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'ZipCodeValidator',
                '"./ZipCodeValidator"',
                'ZipCodeValidator',
                'ZCV',
                '"./ZipCodeValidator1"',
                'validator',
                '"./ZipCodeValidator2"',
                '"./my-module.js"',
                'APIResponseType',
                '"./api"',
                'APIResponseType1',
                '"./api1"',
                'getResponse',
                'APIResponseType2',
                '"./api2"',
            ],
        ],
        operatorsDesired: [
            [
                'import',
                '{}',
                'from',
                'import',
                '{}',
                'as',
                'from',
                'import',
                '*',
                'as',
                'from',
                'import',
                'import',
                '{}',
                'from',
                'import',
                'type',
                '{}',
                'from',
                'import',
                '{}',
                ',',
                'type',
                'from',
            ],
        ],
    },
    {
        name: 'Template Expression - simple',
        skip: false,
        codeToParse: 'warn(`Duplicated seriesKey in universalTransition ${transitionKeyStr}`);',
        numItemsInHeirarchy: 1,
        operandsDesired: [['warn', '"Duplicated seriesKey in universalTransition "', 'transitionKeyStr', '""']],
        operatorsDesired: [['()', '${}']],
    },
    {
        name: 'Template Expression - with head, middle, and tail',
        skip: false,
        codeToParse:
            'warn(`First: ${firstElem}, Second: ${secondElem}, Third: ${thirdElem}, Fourth: ${fourthElem}, `);',
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'warn',
                '"First: "',
                'firstElem',
                '", Second: "',
                'secondElem',
                '", Third: "',
                'thirdElem',
                '", Fourth: "',
                'fourthElem',
                '", "',
            ],
        ],
        operatorsDesired: [['()', '${}', '${}', '${}', '${}']],
    },
    {
        name: 'Void Expression',
        skip: false,
        codeToParse: `
(symbolPath as LineECSymbol).__specifiedRotation = symbolRotate == null || isNaN(symbolRotate)
    ? void 0
    : +symbolRotate * Math.PI / 180 || 0;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'symbolPath',
                'LineECSymbol',
                '___specifiedRotation',
                'symbolRotate',
                'isNaN',
                'symbolRotate',
                '0',
                'symbolRotate',
                'Math',
                'PI',
                '180',
                '0',
            ],
        ],
        operatorsDesired: [
            ['()', 'as', '.', '=', '==', 'null', '||', '()', '?', 'void', ':', '+', '*', '.', '/', '||'],
        ],
    },
    {
        name: 'Array Binding Pattern',
        skip: false,
        codeToParse: `
const [min1, max1] = bboxFromPoints(points1);
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['min1', 'max1', 'bboxFromPoints', 'points1']],
        operatorsDesired: [['const', '[]', ',', '=', '()']],
    },
    {
        name: 'Constructor Type',
        skip: false,
        codeToParse: `
type Constructor<T> = new (...args: any[]) => T;
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['Constructor', 'T', 'args', 'T'],
            ['Constructor', 'T', 'args', 'T'],
        ],
        operatorsDesired: [
            ['type', '<>', '=', 'new', '()', '...', ':', 'any', '[]', '=>'],
            ['type', '<>', '=', 'new', '()', '...', ':', 'any', '[]', '=>'],
        ],
    },
    {
        name: 'No Substitution Template Literal',
        skip: false,
        codeToParse:
            'console.error(`"import echarts from \'echarts/lib/echarts\'" is not supported anymore. Use "import * as echarts from \'echarts/lib/echarts\'" instead;`);',
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'console',
                'error',
                '""import echarts from \'echarts/lib/echarts\'" is not supported anymore. Use "import * as echarts from \'echarts/lib/echarts\'" instead;"',
            ],
        ],
        operatorsDesired: [['.', '()']],
    },
    {
        name: 'Namespace Export',
        skip: false,
        codeToParse: `
export * as zrender from 'zrender/src/zrender';
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['zrender', '"zrender/src/zrender"']],
        operatorsDesired: [['export', '*', 'as', 'from']],
    },
    {
        name: 'Rest Type',
        skip: false,
        codeToParse: `
const SYMBOL_PROPS: [...typeof SYMBOL_PROPS_WITH_CB, 'symbolKeepAspect'] = SYMBOL_PROPS_WITH_CB.concat([
    'symbolKeepAspect'
] as any) as any;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'SYMBOL_PROPS',
                'SYMBOL_PROPS_WITH_CB',
                '"symbolKeepAspect"',
                'SYMBOL_PROPS_WITH_CB',
                'concat',
                '"symbolKeepAspect"',
            ],
        ],
        operatorsDesired: [['const', ':', '[]', '...', 'typeof', ',', '=', '.', '()', '[]', 'as', 'any', 'as', 'any']],
    },
    {
        name: 'Enum & Enum Member',
        skip: false,
        codeToParse: `
export enum AppStatus {
  /**
   * Application is accessible.
   */
  accessible = 0,
  /**
   * Application is not accessible.
   */
  inaccessible = 1,
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['AppStatus', 'accessible', '0', 'inaccessible', '1'],
            ['AppStatus', 'accessible', '0', 'inaccessible', '1'],
        ],
        operatorsDesired: [
            ['export', 'enum', '{}', '=', ',', '=', ','],
            ['export', 'enum', '{}', '=', ',', '=', ','],
        ],
    },
    {
        name: 'Yield & Yield*',
        skip: false,
        codeToParse: `
function* getHostHashes(actualHost: string) {
    yield new Sha256().update(actualHost, 'utf8').digest('hex');
    yield* func1();
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['getHostHashes', 'actualHost', 'Sha256', 'update', 'actualHost', '"utf8"', 'digest', '"hex"', 'func1'],
            ['getHostHashes', 'actualHost', 'Sha256', 'update', 'actualHost', '"utf8"', 'digest', '"hex"', 'func1'],
        ],
        operatorsDesired: [
            [
                'function',
                '*',
                '()',
                ':',
                'string',
                '{}',
                'yield',
                'new',
                '()',
                '.',
                '()',
                ',',
                '.',
                '()',
                'yield',
                '*',
                '()',
            ],
            [
                'function',
                '*',
                '()',
                ':',
                'string',
                '{}',
                'yield',
                'new',
                '()',
                '.',
                '()',
                ',',
                '.',
                '()',
                'yield',
                '*',
                '()',
            ],
        ],
    },
    {
        name: 'Tagged Template Expression',
        skip: false,
        codeToParse: `
if (showHelp) {
  log.write(
    dedent(chalk\`
      {dim usage:} node scripts/build
    \`)
);
  process.exit(1);
}
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [
            [
                'showHelp',
                'log',
                'write',
                'dedent',
                'chalk',
                '"\n      {dim usage:} node scripts/build\n    "',
                'process',
                'exit',
                '1',
            ],
        ],
        operatorsDesired: [
            [
                'if',
                '()',
                '{}',
                '.',
                '()',
                '()',
                // ',',
                '.',
                '()',
            ],
        ],
    },
    {
        name: 'Import Type & Export Default',
        skip: false,
        codeToParse: `
declare module 'react-redux/lib/utils/shallowEqual' {
  const shallowEqual: typeof import('react-redux').shallowEqual;

  // eslint-disable-next-line import/no-default-export
  export default shallowEqual;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['"react-redux/lib/utils/shallowEqual"', 'shallowEqual', '"react-redux"', 'shallowEqual', 'shallowEqual'],
            ['"react-redux/lib/utils/shallowEqual"', 'shallowEqual', '"react-redux"', 'shallowEqual', 'shallowEqual'],
        ],
        operatorsDesired: [
            ['declare', 'module', '{}', 'const', ':', 'typeof', 'import', '()', '.', 'export', 'default'],
            ['declare', 'module', '{}', 'const', ':', 'typeof', 'import', '()', '.', 'export', 'default'],
        ],
    },
    {
        name: 'Meta Property',
        skip: false,
        codeToParse: `
export class KbnError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
        `,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            ['KbnError', 'Error', 'message', 'message', 'Object', 'setPrototypeOf', 'target', 'prototype'],
            ['KbnError', 'Error', 'message', 'message', 'Object', 'setPrototypeOf', 'target', 'prototype'],
            ['message', 'message', 'Object', 'setPrototypeOf', 'target', 'prototype'],
        ],
        operatorsDesired: [
            [
                'export',
                'class',
                'extends',
                '{}',
                'constructor',
                '()',
                ':',
                'string',
                '{}',
                'super',
                '()',
                '.',
                '()',
                'this',
                ',',
                'new',
                '.',
                '.',
            ],
            [
                'export',
                'class',
                'extends',
                '{}',
                'constructor',
                '()',
                ':',
                'string',
                '{}',
                'super',
                '()',
                '.',
                '()',
                'this',
                ',',
                'new',
                '.',
                '.',
            ],
            ['constructor', '()', ':', 'string', '{}', 'super', '()', '.', '()', 'this', ',', 'new', '.', '.'],
        ],
    },
    {
        name: 'Spread Assignment',
        skip: false,
        codeToParse: `
export const INITIAL_STATE: State = {
  ...SUPER_INITIAL_STATE,
  skipIntervals: [],
};
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['INITIAL_STATE', 'State', 'SUPER_INITIAL_STATE', 'skipIntervals']],
        operatorsDesired: [['export', 'const', ':', '=', '{}', '...', ',', ':', '[]']],
    },
    {
        name: 'Type Assertion',
        skip: false,
        codeToParse: `
function foo(): C & ((...args: A) => T) {
    return <C & ((...args: A) => T)>_Class;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['foo', 'C', 'args', 'A', 'T', 'C', 'args', 'A', 'T', '_Class'],
            ['foo', 'C', 'args', 'A', 'T', 'C', 'args', 'A', 'T', '_Class'],
        ],
        operatorsDesired: [
            [
                'function',
                '()',
                ':',
                '&',
                '()',
                '()',
                '...',
                ':',
                '=>',
                '{}',
                'return',
                '<>',
                '&',
                '()',
                '()',
                '...',
                ':',
                '=>',
            ],
            [
                'function',
                '()',
                ':',
                '&',
                '()',
                '()',
                '...',
                ':',
                '=>',
                '{}',
                'return',
                '<>',
                '&',
                '()',
                '()',
                '...',
                ':',
                '=>',
            ],
        ],
    },
    {
        name: 'Import Assertions - Assert Clause & Assert Entry',
        skip: false,
        codeToParse: `
import obj from "./something.json" assert { type: "json" };
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['obj', '"./something.json"', '"json"']],
        operatorsDesired: [['import', 'from', 'assert', '{}', 'type', ':']],
    },
    {
        name: 'External Module Reference',
        skip: false,
        codeToParse: `
import React = require('react');
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['React', '"react"']],
        operatorsDesired: [['import', '=', 'require', '()']],
    },
    {
        name: 'Optional Type',
        skip: false,
        codeToParse: `
export function getPackageDetails(pkg: string): [string, string?] {
  const idx = pkg.lastIndexOf('@');
  if (idx <= 0) {
    return [pkg, undefined];
  }
  const packageName = pkg.slice(0, idx);
  const packageVersion = pkg.slice(idx + 1);
  return [packageName, packageVersion];
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            [
                'getPackageDetails',
                'pkg',
                'idx',
                'pkg',
                'lastIndexOf',
                '"@"',
                'idx',
                '0',
                'pkg',
                'packageName',
                'pkg',
                'slice',
                '0',
                'idx',
                'packageVersion',
                'pkg',
                'slice',
                'idx',
                '1',
                'packageName',
                'packageVersion',
            ],
            [
                'getPackageDetails',
                'pkg',
                'idx',
                'pkg',
                'lastIndexOf',
                '"@"',
                'idx',
                '0',
                'pkg',
                'packageName',
                'pkg',
                'slice',
                '0',
                'idx',
                'packageVersion',
                'pkg',
                'slice',
                'idx',
                '1',
                'packageName',
                'packageVersion',
            ],
        ],
        operatorsDesired: [
            [
                'export',
                'function',
                '()',
                ':',
                'string',
                ':',
                '[]',
                'string',
                ',',
                'string',
                '?',
                '{}',
                'const',
                '=',
                '.',
                '()',
                'if',
                '()',
                '<=',
                '{}',
                'return',
                '[]',
                ',',
                'undefined',
                'const',
                '=',
                '.',
                '()',
                ',',
                'const',
                '=',
                '.',
                '()',
                '+',
                'return',
                '[]',
                ',',
            ],
            [
                'export',
                'function',
                '()',
                ':',
                'string',
                ':',
                '[]',
                'string',
                ',',
                'string',
                '?',
                '{}',
                'const',
                '=',
                '.',
                '()',
                'if',
                '()',
                '<=',
                '{}',
                'return',
                '[]',
                ',',
                'undefined',
                'const',
                '=',
                '.',
                '()',
                ',',
                'const',
                '=',
                '.',
                '()',
                '+',
                'return',
                '[]',
                ',',
            ],
        ],
    },
    {
        name: 'Import & Declare TSX Component',
        skip: false,
        codeToParse: `
import MyComponent from "./myComponent";
<MyComponent />; // ok
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 1,
        operandsDesired: [['MyComponent', '"./myComponent"', 'MyComponent']],
        operatorsDesired: [['import', 'from', '< />']],
    },
    {
        name: 'TSX Attribute, Attributes, and Expression',
        skip: false,
        codeToParse: `
function Story(props) {
  const SpecificStory = components[props.storyType];
  return <SpecificStory story={props.story} />;
}
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            [
                'Story',
                'props',
                'SpecificStory',
                'components',
                'props',
                'storyType',
                'SpecificStory',
                'story',
                'props',
                'story',
            ],
            [
                'Story',
                'props',
                'SpecificStory',
                'components',
                'props',
                'storyType',
                'SpecificStory',
                'story',
                'props',
                'story',
            ],
        ],
        operatorsDesired: [
            ['function', '()', '{}', 'const', '=', '[]', '.', 'return', '< />', '=', '{}', '.'],
            ['function', '()', '{}', 'const', '=', '[]', '.', 'return', '< />', '=', '{}', '.'],
        ],
    },
    {
        name: 'TSX Non-Bracketed Attribute and TSX Spread Operator',
        skip: false,
        codeToParse: `
function App1() {
  return <Greeting firstName="Ben" lastName="Hector" />;
}

function App2() {
  const props = {firstName: 'Ben', lastName: 'Hector'};
  return <Greeting {...props} />;
}
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 3,
        operandsDesired: [
            [
                'App1',
                'Greeting',
                'firstName',
                '"Ben"',
                'lastName',
                '"Hector"',
                'App2',
                'props',
                'firstName',
                '"Ben"',
                'lastName',
                '"Hector"',
                'Greeting',
                'props',
            ],
            ['App1', 'Greeting', 'firstName', '"Ben"', 'lastName', '"Hector"'],
            ['App2', 'props', 'firstName', '"Ben"', 'lastName', '"Hector"', 'Greeting', 'props'],
        ],
        operatorsDesired: [
            [
                'function',
                '()',
                '{}',
                'return',
                '< />',
                '=',
                '=',
                'function',
                '()',
                '{}',
                'const',
                '=',
                '{}',
                ':',
                ',',
                ':',
                'return',
                '< />',
                '...',
            ],
            ['function', '()', '{}', 'return', '< />', '=', '='],
            ['function', '()', '{}', 'const', '=', '{}', ':', ',', ':', 'return', '< />', '...'],
        ],
    },
    {
        name: 'TSX Component with expression in value',
        skip: false,
        codeToParse: `
<MyComponent foo={1 + 2 + 3 + 4} />
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 1,
        operandsDesired: [['MyComponent', 'foo', '1', '2', '3', '4']],
        operatorsDesired: [['< />', '=', '{}', '+', '+', '+']],
    },
    {
        name: 'TSX Element, Opening Element, Closing Element, and Text',
        skip: false,
        codeToParse: `
<MyComponent>Hello world!</MyComponent>
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 1,
        operandsDesired: [['MyComponent', '"Hello world!"', 'MyComponent']],
        operatorsDesired: [['<>', '</>']],
    },
    {
        name: 'TSX Fragment - Modern',
        skip: false, // TODO - revisit when `render()` -> ['render', '()']
        codeToParse: `
render() {
  return (
    <>
      <ChildA />
    </>
  );
}
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 1,
        operandsDesired: [['ChildA']],
        operatorsDesired: [['{}', 'return', '()', '<>', '< />', '</>']],
    },
    {
        name: 'TSX Fragment - Original',
        skip: false,
        codeToParse: `
render() {
  return (
    <React.Fragment>
      <ChildB />
    </React.Fragment>
  );
}
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 1,
        operandsDesired: [['React', 'Fragment', 'ChildB', 'React', 'Fragment']],
        operatorsDesired: [['{}', 'return', '()', '<>', '.', '< />', '</>', '.']],
    },
    {
        name: 'Template Literal Type',
        skip: false,
        codeToParse: `
export interface CronProps {
    schedule?: \`rate(\${string})\` | \`cron(\${string}, \${string})\`;
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['CronProps', 'schedule', '"rate("', '")"', '"cron("', '", "', '")"'],
            ['CronProps', 'schedule', '"rate("', '")"', '"cron("', '", "', '")"'],
        ],
        operatorsDesired: [
            ['export', 'interface', '{}', '?', ':', 'string', '|', 'string', ',', 'string'],
            ['export', 'interface', '{}', '?', ':', 'string', '|', 'string', ',', 'string'],
        ],
    },
    {
        name: 'Debugger Statement',
        skip: false,
        codeToParse: `
await page.evaluate(() => {
    debugger; // eslint-disable-line no-debugger
});
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['page', 'evaluate']],
        operatorsDesired: [['await', '.', '()', '()', '=>', '{}', 'debugger']],
    },
    {
        name: 'With Statement',
        skip: false,
        codeToParse: `
declare module M {
    with (x) {
    }
}
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['M', 'x'],
            ['M', 'x'],
        ],
        operatorsDesired: [
            ['declare', 'module', '{}', 'with', '()', '{}'],
            ['declare', 'module', '{}', 'with', '()', '{}'],
        ],
    },
    {
        name: 'Namespace Export Declaration',
        skip: false,
        codeToParse: `
export as namespace CodeMirror;
        `,
        numItemsInHeirarchy: 1,
        operandsDesired: [['CodeMirror']],
        operatorsDesired: [['export', 'as', 'namespace']],
    },
    {
        name: 'Decorators',
        skip: false,
        codeToParse: `
@Component({
    selector: 'doc-button',
    template: '<button>{{ label }}</button>',
})
export class InputComponent<T> {
    @ViewChild('buttonRef', { static: false }) buttonRef: ElementRef;

    /** Appearance style of the button. */
    @Input()
    public appearance: 'primary' | 'secondary' = 'secondary';
}
        `,
        numItemsInHeirarchy: 4,
        operandsDesired: [
            [
                'Component',
                'selector',
                '"doc-button"',
                'template',
                '"<button>{{ label }}</button>"',
                'InputComponent',
                'T',
                'ViewChild',
                '"buttonRef"',
                'buttonRef',
                'ElementRef',
                'Input',
                'appearance',
                '"primary"',
                '"secondary"',
                '"secondary"',
            ],
            [
                'Component',
                'selector',
                '"doc-button"',
                'template',
                '"<button>{{ label }}</button>"',
                'InputComponent',
                'T',
                'ViewChild',
                '"buttonRef"',
                'buttonRef',
                'ElementRef',
                'Input',
                'appearance',
                '"primary"',
                '"secondary"',
                '"secondary"',
            ],
            ['ViewChild', '"buttonRef"', 'buttonRef', 'ElementRef'],
            ['Input', 'appearance', '"primary"', '"secondary"', '"secondary"'],
        ],
        operatorsDesired: [
            [
                '@',
                '()',
                '{}',
                ':',
                ',',
                ':',
                'export',
                'class',
                '<>',
                '{}',
                '@',
                '()',
                ',',
                '{}',
                'static',
                ':',
                'false',
                ':',
                '@',
                '()',
                'public',
                ':',
                '|',
                '=',
            ],
            [
                '@',
                '()',
                '{}',
                ':',
                ',',
                ':',
                'export',
                'class',
                '<>',
                '{}',
                '@',
                '()',
                ',',
                '{}',
                'static',
                ':',
                'false',
                ':',
                '@',
                '()',
                'public',
                ':',
                '|',
                '=',
            ],
            ['@', '()', ',', '{}', 'static', ':', 'false', ':'],
            ['@', '()', 'public', ':', '|', '='],
        ],
    },
    // // PLACEHOLDER - useful when pulling in a new file to find what's present
    // {
    //     name: 'File Search',
    //     skip: false,
    //     codeToParse: fs.readFileSync('/Users/ericmeadows/git/echarts/src/chart/custom/CustomView.ts', 'utf8'),
    //     numItemsInHeirarchy: 1,
    //     operandsDesired: [[]],
    //     operatorsDesired: [[]],
    // },
];

for (const testItem of testItems.slice()) {
    if (!ignoreSkipParameter && testItem.skip) continue;
    test(testItem.name, () => {
        console.log(`TEST ::> ${testItem.name}`);
        const sourceFile = ts.createSourceFile(
            'test',
            testItem.codeToParse,
            ts.ScriptTarget.ES3,
            false,
            testItem.scriptKind ? testItem.scriptKind : ts.ScriptKind.TS
        );
        const document = new lsif.lib.codeintel.lsiftyped.Document({
            relative_path: sourceFile.fileName,
            occurrences: [],
        });
        const input = new Input(sourceFile.fileName, sourceFile.getText());
        const visitor = new FileIndexer(
            checker,
            input,
            document,
            symbolCache,
            packages,
            sourceFile,
            options.writeIndex,
            options.counter,
            declarations,
            references,
            languageService,
            options.dev,
            true
        );
        visitor.index();
        assert.equal(visitor.currentComponentHeirarchy.length, testItem.numItemsInHeirarchy);

        assert.equal(
            JSON.stringify(
                visitor.currentComponentHeirarchy.map((value) => {
                    return value.halstead.operators;
                })
            ),
            JSON.stringify(testItem.operatorsDesired)
        );
        assert.equal(
            JSON.stringify(
                visitor.currentComponentHeirarchy.map((value) => {
                    return value.halstead.operands;
                })
            ),
            JSON.stringify(testItem.operandsDesired)
        );
    });
}

// Debugging:  Useful to trace down implementations
const DEBUG = false;
const directoryToSearch = '/Users/ericmeadows/git/violet';
const searchExtension = 'sx'; // ".ts";
if (DEBUG) {
    let files: string[] = [];
    function ThroughDirectoryTs(Directory: string, endsWith: string) {
        fs.readdirSync(Directory).forEach((File) => {
            const Absolute = path.join(Directory, File);
            try {
                if (fs.statSync(Absolute).isDirectory()) return ThroughDirectoryTs(Absolute, endsWith);
                if (!File.endsWith(endsWith)) return;
                return files.push(Absolute);
            } catch (error) {
                console.log(error);
            }
        });
    }

    function getScriptKind(file: string): ts.ScriptKind {
        const [, extension] = file.split(/\.(?=[^\.]+$)/);
        switch (extension) {
            case 'js':
                return ts.ScriptKind.JS;
            case 'jsx':
                return ts.ScriptKind.JSX;
            case 'ts':
                return ts.ScriptKind.TS;
            case 'tsx':
                return ts.ScriptKind.TSX;
            case 'json':
                return ts.ScriptKind.JSON;
        }
        return ts.ScriptKind.Unknown;
    }

    ThroughDirectoryTs(directoryToSearch, searchExtension);
    for (const file of files) {
        test(file, () => {
            const sourceFile = ts.createSourceFile(
                file,
                fs.readFileSync(file, 'utf8'),
                ts.ScriptTarget.ES3,
                false,
                getScriptKind(file)
            );
            const document = new lsif.lib.codeintel.lsiftyped.Document({
                relative_path: sourceFile.fileName,
                occurrences: [],
            });
            const input = new Input(sourceFile.fileName, sourceFile.getText());
            const visitor = new FileIndexer(
                checker,
                input,
                document,
                symbolCache,
                packages,
                sourceFile,
                options.writeIndex,
                options.counter,
                declarations,
                references,
                languageService,
                options.dev,
                true
            );
            visitor.index();
        });
    }
}

test.run();
