import { Buffer } from 'buffer';
import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FixtureResult, IFixtureResultOptions } from './result';

export { FixtureResult, IFixtureResultOptions };

const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';

const NATIVE_DIR = path.join(__dirname, '..', 'src', 'native');
const FIXTURE = path.join(NATIVE_DIR, 'fixture.c');

export interface IFixtureOptions {
  readonly buildDir: string;
  readonly clang?: string;
  readonly extra?: ReadonlyArray<string>;
  readonly maxParallel?: number;
}

export interface IFixtureBuildOptions {
  readonly extra?: ReadonlyArray<string>;
}

export interface IFixtureArtifacts {
  readonly bitcode?: Buffer;
  readonly header: string;
  readonly llvm?: string;
}

interface IFixtureInternalOptions {
  readonly buildDir: string;
  readonly clang: string;
  readonly extra: ReadonlyArray<string> | undefined;
  readonly maxParallel: number;
}

// Just a random value, really
export const ERROR_PAUSE = 0x7fa73caa;

export class Fixture {
  private readonly options: IFixtureInternalOptions;

  constructor(options: IFixtureOptions) {
    this.options = {
      buildDir: options.buildDir,
      clang: options.clang === undefined ? CLANG : options.clang,
      extra: options.extra,
      maxParallel: options.maxParallel === undefined ?
        os.cpus().length : options.maxParallel,
    };

    try {
      fs.mkdirSync(this.options.buildDir);
    } catch (e) {
      // no-op
    }
  }

  public build(artifacts: IFixtureArtifacts, name: string,
               options: IFixtureBuildOptions = {}): FixtureResult {
    const BUILD_DIR = this.options.buildDir;

    const hash = crypto.createHash('sha256');

    const llvm = path.join(BUILD_DIR, name + '.ll');
    const bitcode = path.join(BUILD_DIR, name + '.bc');
    const header = path.join(BUILD_DIR, name + '.h');

    hash.update('header');
    hash.update(artifacts.header);
    fs.writeFileSync(header, artifacts.header);

    let args = [
      '-g3', '-Os', '-fvisibility=hidden',
    ];

    // This is rather lame, but should work
    if (CFLAGS) {
      args = args.concat(CFLAGS.split(/\s+/g));
    }

    args = args.concat([
      '-include', header, '-I', NATIVE_DIR,
      FIXTURE,
    ]);
    if (artifacts.llvm !== undefined) {
      hash.update('llvm');
      hash.update(artifacts.llvm);
      fs.writeFileSync(llvm, artifacts.llvm);
      args.push(llvm);
    } else if (artifacts.bitcode !== undefined) {
      hash.update('bitcode');
      hash.update(artifacts.bitcode);
      fs.writeFileSync(bitcode, artifacts.bitcode);
      args.push(bitcode);
    }

    if (this.options.extra) {
      args = args.concat(this.options.extra);
    }
    if (options.extra) {
      args = args.concat(options.extra);
    }
    hash.update(args.join(' '));
    const digest = hash.digest('hex');

    const out = path.join(BUILD_DIR, name + '.' + digest);

    // Use cached binary
    if (fs.existsSync(out)) {
      return new FixtureResult(out, this.options.maxParallel);
    }

    args.push('-o', out);

    const ret = spawnSync(CLANG, args);
    if (ret.status !== 0) {
      if (ret.stdout) {
        process.stderr.write(ret.stdout);
      }
      if (ret.stderr) {
        process.stderr.write(ret.stderr);
      }
      if (ret.error) {
        throw ret.error;
      }
      throw new Error('clang exit code: ' + (ret.status || ret.signal));
    }

    return new FixtureResult(out, this.options.maxParallel);
  }
}
