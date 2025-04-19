import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export type FixtureExpected = string | RegExp | ReadonlyArray<string | RegExp>;

const WASM_RUNNER = path.join(__dirname, '..', 'src', 'wasm-runner.js');

interface IRange {
  readonly from: number;
  readonly to: number;
}

interface ISingleRun {
  readonly name: string;
  readonly outputs: ReadonlyArray<string>;
}

export interface IFixtureResultOptions {
  readonly noScan?: boolean;
  readonly scan?: number;
}

export class FixtureResult {
  constructor(private readonly executables: ReadonlyArray<string>,
              private readonly maxParallel: number) {
  }

  public async check(input: string, expected: FixtureExpected,
                     options: IFixtureResultOptions = {}): Promise<void> {
    const ranges: IRange[] = [];
    const maxParallel = this.maxParallel;

    const rawLength = Buffer.byteLength(input);
    const len = Math.ceil(rawLength / maxParallel);

    if (options.noScan === true) {
      ranges.push({ from: rawLength, to: rawLength + 1 });
    } else if (options.scan) {
      ranges.push({ from: options.scan, to: options.scan + 1 });
    } else {
      for (let i = 1; i <= rawLength; i += len) {
        ranges.push({
          from: i,
          to: Math.min(i + len, rawLength + 1),
        });
      }
    }

    await Promise.all(ranges.map(async (range) => {
      for (const single of await this.spawn(range, input)) {
        for (const [ index, output ] of single.outputs.entries()) {
          this.checkScan(single.name, index + 1, output, expected);
        }
      }
    }));
  }

  private async spawn(range: IRange, input: string): Promise<ReadonlyArray<ISingleRun>> {
    return await Promise.all(this.executables.map((executable) => {
      return this.spawnSingle(executable, range, input);
    }));
  }

  private async spawnSingle(executable: string, range: IRange, input: string): Promise<ISingleRun> {
    const name = path.basename(executable);

    let bin = executable;
    const args = [
      `${range.from}:${range.to}`,
      input,
    ];

    if (executable.endsWith('.wasm')) {
      bin = process.execPath;
      args.unshift(executable);
      args.unshift(WASM_RUNNER);
    }

    const proc = spawn(bin, args, {
      shell: process.platform === 'win32',
      stdio: [ null, 'pipe', 'pipe' ],
    });

    const stdout: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const onEnd =
      new Promise<void>(resolve => proc.stdout.once('end', () => resolve()));
    const { code, signal } = await (new Promise((resolve) => {
      proc.once('exit', (exitCode, exitSignal) => {
        resolve({ code: exitCode!, signal: exitSignal! });
      });
    }) as Promise<{ code: number; signal: string }>);

    await onEnd;

    const stdoutText = Buffer.concat(stdout).toString();
    const stderrText = Buffer.concat(stderr).toString();
    const stdOutErr = `stdout: ${stdoutText}\nstderr: ${stderrText}`;

    if (signal) {
      throw new Error(`Test "${name}" killed with signal: "${signal}".\n${stdOutErr}`);
    }

    if (code !== 0) {
      throw new Error(`Test "${name}" exited with code: "${code}".\n${stdOutErr}`);
    }

    const out = stdoutText.split(/===== SCAN \d+ START =====\n/g).slice(1);

    return {
      name,
      outputs: out.map(part => this.normalizeSpans(part)),
    };
  }

  private checkScan(name: string, scan: number, actual: string,
                    expected: FixtureExpected): void {
    if (typeof expected === 'string') {
      assert.strictEqual(actual, expected,
        `Executable: ${name}\n` +
        `Scan value: ${scan}`);
      return;
    }

    if (expected instanceof RegExp) {
      expected.lastIndex = 0;
      assert.ok(expected.test(actual),
        `Executable: ${name}\n` +
        `Scan value: ${scan}\n` +
        `  got     : ${JSON.stringify(actual)}\n` +
        `  against : ${expected}`);
      return;
    }

    assert(
      Array.isArray(expected) &&
      expected.every((line) => {
        return typeof line === 'string' || line instanceof RegExp;
      }),
      '`expected` must be a string, RegExp, or Array[String|RegExp]');

    const lines = actual.split('\n');
    while (lines.length && lines[lines.length - 1]) {
      lines.pop();
    }

    // If they differ - we are going to fail
    while (lines.length < expected.length) {
      lines.push('');
    }

    // Just make it fail, there shouldn't be extra lines
    const expectedArr = (expected as ReadonlyArray<string | RegExp>).slice();
    while (expectedArr.length < lines.length) {
      expectedArr.push(/$^/);
    }

    lines.forEach((line, lineNum) => {
      const expectedLine = expectedArr[lineNum];

      if (typeof expectedLine === 'string') {
        assert.strictEqual(line, expectedLine,
          `Executable: ${name}\n` +
          `Scan value: ${scan} at line: ${lineNum + 1}\n` +
          `  output  : ${lines.join('\n')}`);
        return;
      }

      expectedLine.lastIndex = 0;
      assert.ok(expectedLine.test(line),
        `Executable: ${name}\n` +
        `Scan value: ${scan} at line: ${lineNum + 1}\n` +
        `  got     : ${JSON.stringify(line)}\n` +
        `  against : ${expectedLine}\n` +
        `  output  : ${lines.join('\n')}`);
    });
  }

  private normalizeSpans(source: string): string {
    const lines = source.split(/\n/g);

    type NormalizeItem = { type: 'raw'; value: string } |
      { type: 'span'; off: number; len: number; span: string; value: string };
    const parse = (line: string): NormalizeItem => {
      const match = line.match(
        /^off=(\d+)\s+len=(\d+)\s+span\[([^\]]+)\]="(.*)"$/);
      if (!match) {
        return { type: 'raw', value: line };
      }

      return {
        len: parseInt(match[2], 10),
        off: parseInt(match[1], 10),
        span: match[3],
        type: 'span',
        value: match[4],
      };
    };

    const parsed = lines.filter(l => l).map(parse);
    const lastMap = new Map();
    const res: NormalizeItem[] = [];

    parsed.forEach((obj) => {
      if (obj.type === 'raw') {
        res.push(obj);
        return;
      }

      if (lastMap.has(obj.span)) {
        const last = lastMap.get(obj.span);
        if (last.off + last.len === obj.off) {
          last.len += obj.len;
          last.value += obj.value;

          // Move it to the end
          res.splice(res.indexOf(last), 1);
          res.push(last);
          return;
        }
      }
      res.push(obj);
      lastMap.set(obj.span, obj);
    });

    const stringify = (obj: NormalizeItem): string => {
      if (obj.type === 'raw') {
        return obj.value;
      }

      return `off=${obj.off} len=${obj.len} span[${obj.span}]="${obj.value}"`;
    };
    return res.map(stringify).join('\n') + '\n';
  }
}
