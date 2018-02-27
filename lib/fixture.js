'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;
const Buffer = require('buffer').Buffer;

const async = require('async');

const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';

const INCLUDE_DIR = path.join(__dirname, '..', 'src');
const FIXTURE = path.join(__dirname, '..', 'src', 'fixture.c');

const normalizeSpans = (source) => {
  const lines = source.split(/\n/g);

  const parse = (line) => {
    const match = line.match(
      /^off=(\d+)\s+len=(\d+)\s+span\[([^\]]+)\]="(.*)"$/);
    if (!match)
      return { type: 'raw', value: line };

    return {
      type: 'span',
      off: match[1] | 0,
      len: match[2] | 0,
      span: match[3],
      value: match[4]
    };
  };

  const parsed = lines.filter(l => l).map(parse);
  const lastMap = new Map();
  const res = [];

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

  const stringify = (obj) => {
    if (obj.type === 'raw')
      return obj.value;

    return `off=${obj.off} len=${obj.len} span[${obj.span}]="${obj.value}"`;
  };
  return res.map(stringify).join('\n') + '\n';
};

class Fixture {
  constructor(options) {
    this.options = Object.assign({
      clang: CLANG,
      maxParallel: os.cpus().length
    }, options);

    assert.strictEqual(typeof this.options.buildDir, 'string',
      'Missing `buildDir` option');

    try {
      fs.mkdirSync(this.options.buildDir);
    } catch (e) {
      // no-op
    }
  }

  static get ERROR_PAUSE() {
    // Just a random value, really
    return 0x7fa73caa;
  }

  static create(options) {
    return new Fixture(options);
  }

  build(p, root, name, options) {
    options = options || {};

    const source = p.build(root, {
      debug: process.env.LLPARSE_DEBUG ? 'llparse__debug' : false
    });

    const BUILD_DIR = this.options.buildDir;

    const file = path.join(BUILD_DIR, name + '.ll');
    const header = path.join(BUILD_DIR, name + '.h');
    const out = path.join(BUILD_DIR, name);

    fs.writeFileSync(file, source.llvm);
    fs.writeFileSync(header, source.header);

    let args = [
      '-g3', '-Os', '-fvisibility=hidden'
    ];

    // This is rather lame, but should work
    if (CFLAGS)
      args = args.concat(CFLAGS.split(/\s+/g));

    args = args.concat([
      '-include', header, '-I', INCLUDE_DIR,
      FIXTURE, file
    ]);

    if (this.options.extra)
      args = args.concat(this.options.extra);
    if (options.extra)
      args = args.concat(options.extra);

    args.push('-o', out);

    const ret = spawnSync(CLANG, args);
    if (ret.status !== 0) {
      if (ret.stdout)
        process.stderr.write(ret.stdout);
      if (ret.stderr)
        process.stderr.write(ret.stderr);
      if (ret.error)
        throw ret.error;
      throw new Error('clang exit code: ' + (ret.status || ret.signal));
    }

    return (input, expected, callback) => {
      const buf = Buffer.from(input);

      const ranges = [];
      const len = Math.ceil(buf.length / this.options.maxParallel);
      for (let i = 1; i <= buf.length; i += len)
        ranges.push({ from: i, to: Math.min(i + len, buf.length + 1) });

      async.map(ranges, (range, callback) => {
        const proc = spawn(out, [ range.from + ':' + range.to, buf ], {
          stdio: [ null, 'pipe', 'inherit' ]
        });

        let stdout = '';
        proc.stdout.on('data', chunk => stdout += chunk);

        async.parallel({
          exit: cb => proc.once('exit', (code, sig) => cb(null, { code, sig })),
          end: cb => proc.stdout.once('end', () => cb(null))
        }, (err, data) => {
          if (data.exit.sig)
            return callback(new Error('Killed with: ' + data.exit.sig));
          if (data.exit.code !== 0)
            return callback(new Error('Exit code: ' + data.exit.code));

          let out = stdout.split(/===== SCAN \d+ START =====\n/g).slice(1);
          out = out.map(normalizeSpans);

          callback(null, out);
        });
      }, (err, results) => {
        if (err)
          return callback(err);

        let all = [];
        results.forEach(result => all = all.concat(result));

        for (let i = 0; i < all.length; i++)
          assert.strictEqual(all[i], expected, 'Scan value: ' + (i + 1));

        return callback(null);
      });
    };
  }
}
module.exports = Fixture;
