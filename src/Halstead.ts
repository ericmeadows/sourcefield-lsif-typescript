import { Halstead as LsifHalstead } from './lsif-data/lsif';

// SourceField
export class Halstead {
    operands: (string | number | bigint)[] = new Array<string | number | bigint>();
    operators: string[] = new Array<string>();
    public calculate(): LsifHalstead {
        let operandsDistinct = Array.from(new Set(this.operands));
        let operatorsDistinct = Array.from(new Set(this.operands));

        let halstead = new LsifHalstead();
        halstead.numOperandsTotal = this.operands.length;
        halstead.numOperatorsTotal = this.operators.length;
        halstead.numOperandsDistinct = operandsDistinct.length;
        halstead.numOperatorsDistinct = operatorsDistinct.length;

        halstead.programVocabulary = halstead.numOperandsDistinct + halstead.numOperatorsDistinct;
        halstead.programLength = halstead.numOperandsTotal + halstead.numOperatorsTotal;
        halstead.volume = halstead.programLength + halstead.numOperatorsTotal;

        if (halstead.numOperandsDistinct == 0) {
            return halstead;
        }

        halstead.difficulty =
            ((halstead.numOperatorsDistinct / 2) * halstead.numOperandsTotal) / halstead.numOperandsDistinct;
        halstead.effort = halstead.difficulty * halstead.volume;
        halstead.timeRequiredToProgram = halstead.effort / 18;
        halstead.numberOfDeliveredBugs = Math.pow(halstead.effort, 2.0 / 3) / 3000;
        if (halstead.numOperandsDistinct == 0) {
            return halstead;
        }
        halstead.calculatedEstimatedProgramLength =
            halstead.numOperatorsDistinct * Math.log2(halstead.numOperandsDistinct) +
            halstead.numOperatorsDistinct * Math.log2(halstead.numOperatorsDistinct);
        return halstead;
    }
}
