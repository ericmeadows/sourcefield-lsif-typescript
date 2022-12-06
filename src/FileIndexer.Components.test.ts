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
    skip: 'false',
    dev: false,
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
        name: 'Arrow Function - JSX Component',
        skip: false,
        codeToParse: `
const App = ({ message }: AppProps) => <div>{message}</div>;
        `,
        scriptKind: ts.ScriptKind.TSX,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['App', 'message', 'AppProps', 'div', 'message', 'div'],
            ['message', 'AppProps', 'div', 'message', 'div'],
        ],
        operatorsDesired: [
            ['const', '=', '()', '{}', ':', '=>', '<>', '{}', '</>'],
            ['()', '{}', ':', '=>', '<>', '{}', '</>'],
        ],
    },
    {
        name: 'Arrow Function - Standard Component',
        skip: false,
        codeToParse: `
const typedTest = (input: String): String => {
  return input;
};
        `,
        numItemsInHeirarchy: 2,
        operandsDesired: [
            ['typedTest', 'input', 'String', 'String', 'input'],
            ['input', 'String', 'String', 'input'],
        ],
        operatorsDesired: [
            ['const', '=', '()', ':', ':', '=>', '{}', 'return'],
            ['()', ':', ':', '=>', '{}', 'return'],
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
