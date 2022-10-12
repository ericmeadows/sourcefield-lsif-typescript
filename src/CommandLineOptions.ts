import { Command } from 'commander';
import { PostHog } from 'posthog-node';

import packageJson from '../package.json';
import { Counter } from './Counter';

/** Configuration options to index a multi-project workspace. */
export interface MultiProjectOptions {
    inferTsconfig: boolean;
    progressBar: boolean;
    yarnWorkspaces: boolean;
    yarnBerryWorkspaces: boolean;
    cwd: string;
    output: string;
    indexedProjects: Set<string>;
    dev: boolean;
}

/** Configuration options to index a single TypeScript project. */
export interface ProjectOptions extends MultiProjectOptions {
    projectRoot: string;
    projectDisplayName: string;
    writeIndex: (index: any) => void;
    counter: Counter;
    dev: boolean;
}

export function mainCommand(indexAction: (projects: string[], options: MultiProjectOptions) => void): Command {
    const command = new Command();
    command
        .name('lsif-typescript')
        .version(packageJson.version)
        .description(
            'LSIF indexer for TypeScript and JavaScript\nFor usage examples, see https://github.com/sourcegraph/scip-typescript/blob/main/README.md'
        );
    command
        .command('index')
        .option('--cwd <path>', 'the working directory', process.cwd())
        .option('--yarn-workspaces', 'whether to index all yarn workspaces', false)
        .option('--yarn-berry-workspaces', 'whether to index all yarn v3 workspaces', false)
        .option('--infer-tsconfig', "whether to infer the tsconfig.json file, if it's missing", false)
        .option('--output <path>', 'path to the output file', 'index.scip')
        .option('--no-progress-bar', 'whether to disable the progress bar')
        .option('--dev', 'whether to run in dev mode - shows detailed print outputs')
        .argument('[projects...]')
        .action((parsedProjects, parsedOptions) => {
            indexAction(parsedProjects as string[], parsedOptions as MultiProjectOptions);
        });
    return command;
}
