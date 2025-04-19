import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { FixtureResult, IFixtureResultOptions } from './result';

export { FixtureResult, IFixtureResultOptions };

const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';
const WASM = process.env.WASM;
const WASM_CFLAGS = process.env.WASM_CFLAGS || '';

const NATIVE_DIR = path.join(__dirname, '..', 'src', 'native');
const FIXTURE = path.join(NATIVE_DIR, 'fixture.c');

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

interface IFixtureInternalOptions {
  readonly buildDir: string;
  readonly clang: string;
  readonly wasm: string | undefined;
  readonly extra: ReadonlyArray<string>;
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
      wasm: options.wasm === undefined ? WASM : options.wasm,
      extra: options.extra || [],
      maxParallel: options.maxParallel === undefined ?
        os.cpus().length :
        options.maxParallel,
    };

    try {
      fs.mkdirSync(this.options.buildDir, { recursive: true });
    } catch (e) {
      // no-op
    }
  }

  public async build(artifacts: IFixtureArtifacts, name: string,
                     options: IFixtureBuildOptions = {}): Promise<FixtureResult> {
    const BUILD_DIR = this.options.buildDir;

    const hash = crypto.createHash('sha256');

    const c = path.join(BUILD_DIR, name + '.c');
    const header = path.join(BUILD_DIR, name + '.h');

    hash.update('header');
    hash.update(artifacts.header);
    await fs.promises.writeFile(header, artifacts.header);

    const commonArgs = [
      '-g3', '-Os', '-fvisibility=hidden',
      '-I', NATIVE_DIR,
      '-I', BUILD_DIR,
      '-include', header,
      FIXTURE,
    ];

    const args = {
      c: [ '-msse4.2' ],
      wasm: [
        '-msimd128',
        '-fno-exceptions',
        '-mexec-model=reactor',
        '-Wl,-error-limit=0',
        '-Wl,--allow-undefined',
        '-Wl,--export-dynamic',
        '-Wl,--export-table',
        '-Wl,--export=malloc',
        '-Wl,--export=free',
        '-Wl,--no-entry',
      ],
    };

    // This is rather lame, but should work
    if (CFLAGS) {
      for (const flag of CFLAGS.split(/\s+/g)) {
        args.c.push(flag);
      }
    }
    if (WASM_CFLAGS) {
      for (const flag of WASM_CFLAGS.split(/\s+/g)) {
        args.wasm.push(flag);
      }
    }

    hash.update('c');
    hash.update(artifacts.c);
    await fs.promises.writeFile(c, artifacts.c);
    args.c.push(c);
    args.wasm.push(c);

    for (const extra of this.options.extra) {
      commonArgs.push(extra);
    }
    if (options.extra) {
      for (const extra of options.extra) {
        commonArgs.push(extra);
      }
    }
    hash.update('common-args');
    hash.update(commonArgs.join(' '));

    const digest = hash.digest('hex');

    const executables: string[] = [];

    {
      const out = path.join(BUILD_DIR, name + '-c.' + digest);
      const link = path.join(BUILD_DIR, name + '-c');
      if (!fs.existsSync(out)) {
        await this.clang(
          this.options.clang, commonArgs.concat(args.c, '-o', out));
      }
      try {
        await fs.promises.unlink(link);
      } catch (e) {
        // no-op
      }
      await fs.promises.link(out, link);
      executables.push(out);
    }

    if (this.options.wasm) {
      const out = path.join(BUILD_DIR, name + '-' + digest + '.wasm');
      const link = path.join(BUILD_DIR, name + '.wasm');
      if (!fs.existsSync(out)) {
        await this.clang(
          this.options.wasm, commonArgs.concat(args.wasm, '-o', out));
      }
      try {
        await fs.promises.unlink(link);
      } catch (e) {
        // no-op
      }
      await fs.promises.link(out, link);
      executables.push(out);
    }

    return new FixtureResult(executables, this.options.maxParallel);
  }

  private async clang(bin: string, args: ReadonlyArray<string>): Promise<void> {
    const proc = spawn(bin, args, {
      stdio: [ null, 'pipe', 'pipe' ],
    });

    const stdout: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const code = await (new Promise((resolve) => {
      proc.once('exit', exitCode => resolve(exitCode!));
    }) as Promise<number>);

    if (code !== 0) {
      if (stdout.length > 0) {
        process.stderr.write(Buffer.concat(stdout).toString());
      }
      if (stderr.length > 0) {
        process.stderr.write(Buffer.concat(stderr).toString());
      }

      const escapedArgs = args.map(arg => JSON.stringify(arg));
      throw new Error('clang exit code: ' + code +
        `\narguments: ${escapedArgs.join(' ')}`);
    }
  }
}
