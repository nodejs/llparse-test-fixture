/// <reference types="node" />
import { FixtureResult, IFixtureResultOptions } from './result';
export { FixtureResult, IFixtureResultOptions };
export interface IFixtureOptions {
    readonly buildDir: string;
    readonly clang?: string;
    readonly extra?: ReadonlyArray<string>;
    readonly extraJS?: ReadonlyArray<string>;
    readonly initJS?: string;
    readonly maxParallel?: number;
}
export interface IFixtureBuildOptions {
    readonly extra?: ReadonlyArray<string>;
    readonly extraJS?: ReadonlyArray<string>;
    readonly initJS?: string;
}
export interface IFixtureArtifacts {
    readonly bitcode?: Buffer;
    readonly c?: string;
    readonly js?: string;
    readonly header: string;
    readonly llvm?: string;
}
export declare const ERROR_PAUSE = 2141666474;
export declare class Fixture {
    private readonly options;
    constructor(options: IFixtureOptions);
    build(artifacts: IFixtureArtifacts, name: string, options?: IFixtureBuildOptions): FixtureResult;
    private clang;
}
