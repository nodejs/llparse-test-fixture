export declare type FixtureExpected = string | RegExp | ReadonlyArray<string | RegExp>;
export interface IFixtureResultOptions {
    readonly noScan?: boolean;
    readonly scan?: number;
}
export declare class FixtureResult {
    private readonly executables;
    private readonly maxParallel;
    constructor(executables: ReadonlyArray<string>, maxParallel: number);
    check(input: string, expected: FixtureExpected, options?: IFixtureResultOptions): Promise<void>;
    private spawn;
    private spawnSingle;
    private checkScan;
    private normalizeSpans;
}
