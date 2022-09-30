import { Complexity as LsifComplexity } from './lsif-data/lsif';
import { Halstead } from './Halstead';

export class Complexity {
    inV: number;
    halstead: Halstead = new Halstead();
    constructor(inV: number) {
        this.inV = inV;
    }
    getEmittable(id: number): LsifComplexity {
        let lsifHalstead = this.halstead.calculate();
        return new LsifComplexity({
            id: id,
            type: 'vertex',
            label: 'complexityMeasurements',
            inV: this.inV,
            halstead: lsifHalstead,
        });
    }
}
