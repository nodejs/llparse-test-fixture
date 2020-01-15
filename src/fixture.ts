import { Buffer } from 'buffer';
import { spawn } from 'child_process';
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

const JS_RUNNER = path.join(__dirname, '..', 'bin', 'llparse-test.js');

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

interface IFixtureInternalOptions {
  readonly buildDir: string;
  readonly clang: string;
  readonly extra: ReadonlyArray<string>;
  readonly extraJS: ReadonlyArray<string>;
  readonly initJS?: string;
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
      extra: options.extra || [],
      extraJS: options.extraJS || [],
      maxParallel: options.maxParallel === undefined ?
        os.cpus().length : options.maxParallel,
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

    const llvm = path.join(BUILD_DIR, name + '.ll');
    const bitcode = path.join(BUILD_DIR, name + '.bc');
    const c = path.join(BUILD_DIR, name + '.c');
    const js = path.join(BUILD_DIR, name + '.js');
    const header = path.join(BUILD_DIR, name + '.h');

    hash.update('header');
    hash.update(artifacts.header);
    await fs.promises.writeFile(header, artifacts.header);

    const commonArgs = [
      '-g3', '-Os', '-fvisibility=hidden',
      '-I', NATIVE_DIR,
      '-include', header,
      FIXTURE,
    ];

    // This is rather lame, but should work
    if (CFLAGS) {
      for (const flag of CFLAGS.split(/\s+/g)) {
        commonArgs.push(flag);
      }
    }

    const args = {
      bitcode: [] as string[],
      c: [ '-I', BUILD_DIR ],
      js: [] as string[],
    };
    if (artifacts.llvm !== undefined) {
      hash.update('llvm');
      hash.update(artifacts.llvm);
      await fs.promises.writeFile(llvm, artifacts.llvm);
      args.bitcode.push(llvm);
    } else if (artifacts.bitcode !== undefined) {
      hash.update('bitcode');
      hash.update(artifacts.bitcode);
      await fs.promises.writeFile(bitcode, artifacts.bitcode);
      args.bitcode.push(bitcode);
    }

    if (artifacts.c !== undefined) {
      hash.update('c');
      hash.update(artifacts.c);
      await fs.promises.writeFile(c, artifacts.c);
      args.c.push(c);
    }

    const extraJS = this.options.extraJS.concat(options.extraJS || []);
    const initJS = options.initJS || this.options.initJS;
    if (artifacts.js !== undefined) {
      hash.update('js');
      hash.update(artifacts.js);
      await fs.promises.writeFile(js, artifacts.js);
      args.js.push(js);

      hash.update('extra-js');
      hash.update(extraJS.join(' '));

      if (initJS) {
        hash.update('init-js');
        hash.update(initJS);
      }
    }

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

    const out = path.join(BUILD_DIR, name + '.' + digest);
    const link = path.join(BUILD_DIR, name);

    const executables: string[] = [];

    if (!fs.existsSync(out)) {
      // Compile binary, no cached version available
      await this.clang(commonArgs.concat(args.bitcode, '-o', out));
    }
    try {
      await fs.promises.unlink(link);
    } catch (e) {
      // no-op
    }
    await fs.promises.link(out, link);
    executables.push(out);

    if (artifacts.c !== undefined) {
      const cOut = path.join(BUILD_DIR, name + '-c.' + digest);
      const cLink = path.join(BUILD_DIR, name + '-c');
      if (!fs.existsSync(cOut)) {
        await this.clang(commonArgs.concat(args.c, '-o', cOut));
      }
      try {
        await fs.promises.unlink(cLink);
      } catch (e) {
        // no-op
      }
      await fs.promises.link(cOut, cLink);
      executables.push(cOut);
    }

    if (artifacts.js !== undefined) {
      const jsOut = path.join(BUILD_DIR, name + `-js${process.platform === 'win32' ? '.cmd' : ''}`);

      const jsArgs = [
        `-p ${path.resolve(js).replace(/(\s+)/g, '\\$1')}`,
      ];
      for (const extra of extraJS) {
        jsArgs.push(`-b ${path.resolve(extra).replace(/(\s+)/g, '\\$1')}`);
      }

      if (initJS) {
        jsArgs.push(`-i ${initJS}`);
      }

      const bin = JS_RUNNER.replace(/(\s+)/g, '\\$1');
      const fixedArgs = jsArgs.join(' ');
      const content = process.platform === 'win32'
          ? `node ${bin} ${fixedArgs} "%1" "%2"`
          : `#!/bin/sh\n${bin} ${fixedArgs} "$1" "$2"`;

      await fs.promises.writeFile(jsOut, content);
      await fs.promises.chmod(jsOut, 0o775);
      executables.push(jsOut);
    }

    return new FixtureResult(executables, this.options.maxParallel);
  }

  private async clang(args: ReadonlyArray<string>): Promise<void> {
    const proc = spawn(CLANG, args, {
      stdio: [null, 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const code = await (new Promise((resolve) => {
      proc.once('exit', (exitCode) => resolve(exitCode!));
    }) as Promise<number>);

    if (code !== 0) {
      if (stdout.length > 0) {
        process.stderr.write(Buffer.concat(stdout).toString());
      }
      if (stderr.length > 0) {
        process.stderr.write(Buffer.concat(stderr).toString());
      }

      const escapedArgs = args.map((arg) => JSON.stringify(arg));
      throw new Error('clang exit code: ' + code +
          `\narguments: ${escapedArgs.join(' ')}`);
    }
  }
}
