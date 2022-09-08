import { DocumentSymbolResult, ParentChildRelationships as LsifParentChildRelationships } from './lsif-data/lsif';

export class ParentChildRelationships {
    id: number;
    isModuleLevel: boolean;
    children: ParentChildRelationships[] = new Array<ParentChildRelationships>();
    constructor(id: number, isModuleLevel: boolean) {
        this.id = id;
        this.isModuleLevel = isModuleLevel;
    }
    getEmittable(id: number) {
        return new DocumentSymbolResult({
            id,
            type: 'vertex',
            label: 'documentSymbolResult',
            result: this.getResult(),
        });
    }
    getResult(
        id: number = this.id,
        children: ParentChildRelationships[] = this.children
    ): LsifParentChildRelationships {
        return new LsifParentChildRelationships({
            id: id,
            children: children.map((child) => this.getResult(child.id, child.children)),
        });
    }
}
