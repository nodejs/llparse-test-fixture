import { FixtureResult, IFixtureResultOptions } from './result';
export { FixtureResult, IFixtureResultOptions };
export interface IFixtureOptions {
    readonly buildDir: string;
    readonly clang?: string;
    readonly wasm?: string;
    readonly extra?: ReadonlyArray<string>;
    readonly maxParallel?: number;
}
export interface IFixtureBuildOptions {
    readonly extra?: ReadonlyArray<string>;
}
export interface IFixtureArtifacts {
    readonly header: string;
    readonly c: string;
}
export declare const ERROR_PAUSE = 2141666474;
export declare class Fixture {
    private readonly options;
    constructor(options: IFixtureOptions);
    build(artifacts: IFixtureArtifacts, name: string, options?: IFixtureBuildOptions): Promise<FixtureResult>;
    private clang;
}
