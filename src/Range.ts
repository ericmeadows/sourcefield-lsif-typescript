import * as ts from 'typescript';

import { Position } from './Position';

export class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
    public compare(other: Range): number {
        const byStart = this.start.compare(other.start);
        if (byStart !== 0) {
            return byStart;
        }
        return this.end.compare(other.end);
    }
    public contains(other: Range): boolean {
        if (this.start.line > other.start.line) return false;
        if (this.end.line < other.end.line) return false;
        if (this.start.line == other.start.line && this.start.character > other.start.character) return false;
        if (this.end.line == other.end.line && this.end.character < other.end.character) return false;
        return true;
    }
    public toLsif(): number[] {
        if (this.isSingleLine()) {
            return [this.start.line, this.start.character, this.end.character];
        }
        return [this.start.line, this.start.character, this.end.line, this.end.character];
    }
    public static fromLsif(range: number[]): Range {
        const endLine = range.length === 3 ? range[0] : range[2];
        const endCharacter = range.length === 3 ? range[2] : range[3];
        return new Range(new Position(range[0], range[1]), new Position(endLine, endCharacter));
    }
    // SourceField - this is fullRange, not the moniker range
    public static fromNode(node: ts.Node): Range {
        const sourceFile = node.getSourceFile();
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        return new Range(new Position(start.line, start.character), new Position(end.line, end.character));
    }

    public static fromTextSpan(sourceFile: ts.SourceFile, positionInfo: ts.TextSpan) {
        const start = sourceFile.getLineAndCharacterOfPosition(positionInfo.start);
        const end = sourceFile.getLineAndCharacterOfPosition(positionInfo.start + positionInfo.length);
        return new Range(new Position(start.line, start.character), new Position(end.line, end.character));
    }

    public isSingleLine(): boolean {
        return this.start.line === this.end.line;
    }
}
