import { Range } from './Range';

export class DefinitionRange {
    constructor(public readonly sourceFile: string, public readonly range: Range) {}
}
