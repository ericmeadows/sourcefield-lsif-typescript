#!/usr/bin/env node
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

import * as ts from 'typescript';

import { mainCommand, MultiProjectOptions, ProjectOptions } from './CommandLineOptions';
import { inferTsconfig } from './inferTsconfig';
import * as lsif from './lsif';
import { ProjectIndexer } from './ProjectIndexer';
import { Counter } from './Counter';
import { Metadata, Project, ToolInfo } from './lsif-data/lsif';

import { PostHog } from 'posthog-node';
import { getGitCommit, getGitOrgAndRepo, getLicenseKey } from './environment';

import * as Sentry from '@sentry/node';
import { LANGUAGE, LSIF_VERSION, VERSION } from './version';

export const lsiftyped = lsif.lib.codeintel.lsiftyped;

export function main(): void {
    Sentry.init({
        dsn: 'https://5d2514fa0b3d44e1bdeaed1c4e32428c@sentry.sourcefield.io/4',

        // Set tracesSampleRate to 1.0 to capture 100%
        // of transactions for performance monitoring.
        // We recommend adjusting this value in production
        tracesSampleRate: 1.0,
    });

    mainCommand((projects, options) => indexCommand(projects, options)).parse(process.argv);
    return;
}

export function indexCommand(projects: string[], options: MultiProjectOptions): void {
    const client: PostHog = new PostHog('phc_KXXmufnHuoy4uzHzIdFbYR7BRJt9PJYFMmb3YlopkZR', {
        host: 'https://posthog.sourcefield.io',
    });
    const licenseKey = getLicenseKey();
    if (licenseKey) {
        client.identify({ distinctId: licenseKey });
    }

    const start = new Date().getTime();

    if (options.yarnWorkspaces) {
        projects.push(...listYarnWorkspaces(options.cwd));
    } else if (options.yarnBerryWorkspaces) {
        projects.push(...listYarnBerryWorkspaces(options.cwd));
    } else if (projects.length === 0) {
        projects.push(options.cwd);
    }
    options.cwd = makeAbsolutePath(process.cwd(), options.cwd);
    options.output = makeAbsolutePath(options.cwd, options.output);
    if (!options.indexedProjects) {
        options.indexedProjects = new Set();
    }
    const output = fs.openSync(options.output, 'w');
    let documentCount = 0;
    let counter = new Counter();
    const writeIndex = (index: any): void => {
        if (index.documents) {
            documentCount += index.documents.length;
        }
        fs.writeSync(output, JSON.stringify(index.toObject()) + '\n');
        // SourceField --> change to output json
    };
    let success = false;
    let gitOrg = '';
    let gitRepo = '';
    let gitCommit = '';
    try {
        writeIndex(
            new Metadata({
                id: counter.next(),
                type: 'vertex',
                label: 'metaData',
                version: LSIF_VERSION,
                projectRoot: url.pathToFileURL(options.cwd).toString(),
                positionEncoding: 'utf-8',
                toolInfo: new ToolInfo({ name: `lsif-${LANGUAGE}`, version: VERSION }),
            })
        );
        writeIndex(new Project({ id: counter.next(), type: 'vertex', label: 'project', kind: LANGUAGE }));
        // NOTE: we may want index these projects in parallel in the future.
        // We need to be careful about which order we index the projects because
        // they can have dependencies.
        for (const projectRoot of projects) {
            const projectDisplayName = projectRoot === '.' ? options.cwd : projectRoot;
            indexSingleProject({
                ...options,
                projectRoot,
                projectDisplayName,
                writeIndex,
                counter,
            });
        }
        success = true;
        const gitOrgAndRepo = getGitOrgAndRepo(options.cwd);
        if (gitOrgAndRepo.length == 2) {
            gitOrg = gitOrgAndRepo[0];
            gitRepo = gitOrgAndRepo[1];
        }
        gitCommit = getGitCommit(options.cwd);
    } finally {
        fs.close(output);
        let elapsed = new Date().getTime() - start;
        console.log(`done ${options.output}`);

        const properties = {
            version: VERSION,
            language: LANGUAGE,
            gitOrg: gitOrg,
            gitRepo: gitRepo,
            timeElapsed: elapsed,
        };
        client.capture({
            distinctId: gitCommit,
            event: success ? 'parse-succeeded' : 'parse-failed',
            properties,
        });
        client.shutdown();
    }
}

function makeAbsolutePath(cwd: string, relativeOrAbsolutePath: string): string {
    if (path.isAbsolute(relativeOrAbsolutePath)) {
        return relativeOrAbsolutePath;
    }
    return path.resolve(cwd, relativeOrAbsolutePath);
}

function indexSingleProject(options: ProjectOptions): void {
    if (options.indexedProjects.has(options.projectRoot)) {
        return;
    }
    options.indexedProjects.add(options.projectRoot);
    let config = ts.parseCommandLine(['-p', options.projectRoot], (relativePath: string) =>
        path.resolve(options.projectRoot, relativePath)
    );
    let tsconfigFileName: string | undefined;
    if (config.options.project) {
        const projectPath = path.resolve(config.options.project);
        if (ts.sys.directoryExists(projectPath)) {
            tsconfigFileName = path.join(projectPath, 'tsconfig.json');
        } else {
            tsconfigFileName = projectPath;
        }
        if (!ts.sys.fileExists(tsconfigFileName)) {
            if (options.inferTsconfig) {
                fs.writeFileSync(tsconfigFileName, inferTsconfig(projectPath));
            } else {
                console.error(`- ${options.projectDisplayName} (missing tsconfig.json)`);
                return;
            }
        }
        config = loadConfigFile(tsconfigFileName);
    }

    for (const projectReference of config.projectReferences || []) {
        indexSingleProject({
            ...options,
            projectRoot: projectReference.path,
            projectDisplayName: projectReference.path,
        });
    }

    if (config.fileNames.length > 0) {
        new ProjectIndexer(config, options).index();
    }
}

if (require.main === module) {
    main();
}

function loadConfigFile(file: string): ts.ParsedCommandLine {
    const absolute = path.resolve(file);

    const readResult = ts.readConfigFile(absolute, (path) => ts.sys.readFile(path));

    if (readResult.error) {
        throw new Error(ts.formatDiagnostics([readResult.error], ts.createCompilerHost({})));
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const config = readResult.config;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (config.compilerOptions !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        config.compilerOptions = {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            ...config.compilerOptions,
            ...defaultCompilerOptions(file),
        };
    }
    const basePath = path.dirname(absolute);
    const result = ts.parseJsonConfigFileContent(config, ts.sys, basePath);
    const errors: ts.Diagnostic[] = [];
    for (const error of result.errors) {
        if (error.code === 18003) {
            // Ignore errors about missing 'input' fields, example:
            // > TS18003: No inputs were found in config file 'tsconfig.json'. Specified 'include' paths were '[]' and 'exclude' paths were '["out","node_modules","dist"]'.
            // The reason we ignore this error here is because we report the same
            // error at a higher-level.  It's common to hit on a single TypeScript
            // project with no sources when using the --yarnWorkspaces option.
            // Instead of failing fast at that single project, we only report this
            // error if all projects have no files.
            continue;
        }
        errors.push(error);
    }
    if (errors.length > 0) {
        console.log({ absolute });
        throw new Error(ts.formatDiagnostics(errors, ts.createCompilerHost({})));
    }
    return result;
}

function defaultCompilerOptions(configFileName?: string): ts.CompilerOptions {
    const options: ts.CompilerOptions =
        // Not a typo, jsconfig.json is a thing https://sourcegraph.com/search?q=context:global+file:jsconfig.json&patternType=literal
        configFileName && path.basename(configFileName) === 'jsconfig.json'
            ? {
                  allowJs: true,
                  maxNodeModuleJsDepth: 2,
                  allowSyntheticDefaultImports: true,
                  skipLibCheck: true,
                  noEmit: true,
              }
            : {};
    return options;
}

function listYarnBerryWorkspaces(directory: string): string[] {
    const result: string[] = [];
    const lines = child_process
        .execSync('yarn workspaces list --json', {
            cwd: directory,
            encoding: 'utf-8',
        })
        .split('\n');
    for (const line of lines) {
        if (!line) {
            continue;
        }
        const location = 'location';
        const json = JSON.parse(line);
        if (json[location] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            result.push(path.join(directory, json[location]));
        }
    }
    return result;
}

function listYarnWorkspaces(directory: string): string[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = JSON.parse(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        JSON.parse(
            child_process.execSync('yarn --silent --json workspaces info', {
                cwd: directory,
                encoding: 'utf-8',
            })
        ).data
    );

    const result: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    for (const key of Object.keys(json)) {
        const location = 'location';
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (json[key][location] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            result.push(path.join(directory, json[key][location]));
        }
    }
    return result;
}
