import * as child_process from 'child_process';
import * as Sentry from '@sentry/node';
import { glob } from 'glob';

export function getLicenseKey(): string | undefined {
    if (process.env.SOURCEFIELD_LICENSE_KEY) return process.env.SOURCEFIELD_LICENSE_KEY;
    return;
}

export function getGitUsername(): string | undefined {
    if (process.env.GITHUB_ACTOR) return process.env.GITHUB_ACTOR;
    return;
}

export function getGitCommit(cwd: string): string {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    return child_process.execSync('git rev-parse HEAD', { cwd }).toString();
}

function processGitOrgAndRepoSplit(orgAndRepoSplit: string[]): string[] {
    if (orgAndRepoSplit.length < 2) {
        Sentry.captureMessage(`orgAndRepoSplit.length < 2; (${orgAndRepoSplit})`);
        return orgAndRepoSplit;
    }
    if (orgAndRepoSplit.length > 2) {
        Sentry.captureMessage(`orgAndRepoSplit.length > 2; (${orgAndRepoSplit})`);
        return orgAndRepoSplit.slice(0, 2);
    }
    return orgAndRepoSplit;
}

function getGitOrgAndRepoFromHttps(addressWithoutDotGit: string): string[] {
    const orgAndRepoSplit = addressWithoutDotGit.replace('https://', '').split('/').slice(1);
    if (!orgAndRepoSplit) return [];
    return processGitOrgAndRepoSplit(orgAndRepoSplit);
}

function getGitOrgAndRepoFromGitAt(addressWithoutDotGit: string): string[] {
    const orgAndRepo = addressWithoutDotGit.split(':').pop();
    if (!orgAndRepo) return [];
    const orgAndRepoSplit = orgAndRepo.split('/');
    return processGitOrgAndRepoSplit(orgAndRepoSplit);
}

export function getGitOrgAndRepo(cwd: string): string[] {
    if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY_OWNER) {
        return [process.env.GITHUB_REPOSITORY, process.env.GITHUB_REPOSITORY_OWNER];
    }
    const preOrgAndRepo = child_process.execSync('git config --get remote.origin.url', { cwd }).toString();
    const gitExtensionRemoved = preOrgAndRepo.substring(0, preOrgAndRepo.lastIndexOf('.git'));
    if (gitExtensionRemoved.startsWith('git@')) {
        return getGitOrgAndRepoFromGitAt(gitExtensionRemoved);
    }
    if (gitExtensionRemoved.startsWith('https://')) {
        return getGitOrgAndRepoFromHttps(gitExtensionRemoved);
    }
    return [];
}

export function installPackages(cwd: string) {
    let globbedFiles = glob.sync('**/pnpm-lock.yaml', { ignore: ['**/node_modules/**'], cwd: cwd });
    if (globbedFiles.length !== 0) {
        child_process.execSync('yes | npm install', { cwd }).toString();
        return;
    }
    globbedFiles = glob.sync('**/yarn-lock.yaml', { ignore: ['**/node_modules/**'], cwd: cwd });
    if (globbedFiles.length !== 0) {
        child_process.execSync('yes | yarn install', { cwd }).toString();
        return;
    }
    globbedFiles = glob.sync('**/package-lock.yaml', { ignore: ['**/node_modules/**'], cwd: cwd });
    if (globbedFiles.length !== 0) {
        child_process.execSync('yes | npm install', { cwd }).toString();
        return;
    }
    globbedFiles = glob.sync('**/npm-shrinkwrap.json', { ignore: ['**/node_modules/**'], cwd: cwd });
    if (globbedFiles.length !== 0) {
        child_process.execSync('yes | npm install', { cwd }).toString();
        return;
    }
}
