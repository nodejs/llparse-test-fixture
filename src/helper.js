#!/usr/bin/env node
import { Buffer } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';

import * as yargs from 'yargs';

import DEFAULT_BINDING from '../src/binding';

const argv = yargs
  .option('parser', {
    alias: 'p',
    describe: 'Parser to use',
    type: 'string',
  })
  .option('binding', {
    alias: 'b',
    describe: 'Binding to use',
    type: 'string',
  })
  .option('init', {
    alias: 'i',
    describe: 'The name of function from the binding to be used at init',
    type: 'string',
  })
  .demandOption([ 'parser' ])
  .string('_')
  .command('bench <input>', 'benchmark input', (yargs) => {
    return yargs.positional('input', {
      type: 'string',
      coerce(opt) {
        return opt;
      },
    });
  })
  .command('* <range> <input>', 'scan input', (yargs) => {
    return yargs
      .positional('range', { type: 'string' })
      .positional('input', { type: 'string' });
  })
  .help('h')
  .alias('help', 'h')
  .argv;

const IS_BENCH = argv._[0] === 'bench';

const PARSER_FILE = path.resolve(argv.parser);
const EXTRA_BINDINGS = argv.binding ?
  Array.isArray(argv.binding) ? argv.binding : [ argv.binding ]
  :
  [];

function runOne(binding, p, buf, globalOff = 0) {
  let paused = false;
  let code;

  binding.setGlobalOff(globalOff);

  let off = 0;
  for (;;) {
    code = p.execute(off === 0 ? buf : buf.slice(off));
    if (code !== binding.LLPARSE__ERROR_PAUSE) {
      break;
    }

    if (paused && p.errorOff === 0) {
      binding.llparse__debug(p, buf, off, 'Can\'t make progress after pause');
      return -1;
    }

    off += p.errorOff;
    binding.setGlobalOff(globalOff + off);

    binding.llparse__print(0, 'pause');

    // Resume
    p.error = 0;
    paused = true;
  }

  if (code !== 0) {
    if (code !== p.error) {
      binding.llparse__print(p.errorOff,
        'error code mismatch got=%d expected=%d', code, p.error);
      return -1;
    }

    binding.llparse__print(p.errorOff, "error code=%d reason=\"%s\"", code,
                   p.reason);
  }

  return code;
}

function benchmark(binding, Parser, input) {
  const buf = Buffer.from(input);

  // JS is slower than C, use less bytes
  const TOTAL = 4 * 1024 * 1024 * 1024;
  const ITERATIONS = (TOTAL / buf.length) >>> 0;

  const p = new Parser();
  if (argv.init) {
    binding[argv.init](p);
  }

  const start = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const code = runOne(binding, p, buf);
    if (code !== 0) {
      console.error('got error code %d', code);
    }
  }
  const end = Date.now();

  const secs = (end - start) / 1000;

  const size = (TOTAL / 1024 / 1024).toFixed(2);
  const bandwidth = (TOTAL / secs / 1024 / 1024).toFixed(2);
  const ops = (ITERATIONS / secs).toFixed(2);

  console.log('%s mb | %s mb/s | %s ops/sec | %s s',
    size, bandwidth, ops, secs.toFixed(2));
}

function scan(binding, Parser, range, input) {
  const buf = Buffer.from(input);

  const [ from, to ] = range.split(':', 2).map((x) => parseInt(x, 10) | 0);
  if (from < 1 || to < from) {
    throw new Error('Invalid range');
  }

  for (let scan = from; scan < to; scan++) {
    console.log('===== SCAN %d START =====', scan);

    const p = new Parser();
    if (argv.init) {
      binding[argv.init](p);
    }
    for (let off = 0; off < buf.length; off += scan) {
      if (runOne(binding, p, buf.slice(off, off + scan), off) !== 0) {
        break;
      }
    }
  }
}

async function main() {
  // Load bindings
  const bindings = [ DEFAULT_BINDING ];
  for (const extra of EXTRA_BINDINGS) {
    const m = (await import(path.resolve(extra))).default;
    bindings.push(m.default || m);
  }

  // Apply bindings
  const binding = {};
  for (const apply of bindings) {
    apply(binding, IS_BENCH);
  }

  // Import parser
  const init = (await import(PARSER_FILE)).default;
  const Parser = init(binding);

  if (IS_BENCH) {
    benchmark(binding, Parser, argv.input);
  } else {
    scan(binding, Parser, argv.range, argv.input);
  }
}

main().then(() => {
}).catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
