// Test for a test, huh?

import { LLParse } from 'llparse';
import * as path from 'path';

import { Fixture } from '../src/fixture';

const TMP_DIR = path.join(__dirname, 'tmp');
const EXTRA_CODE = path.join(__dirname, 'fixtures', 'extra.c');

describe('llparse-test-fixture', function() {
  this.timeout(10000);

  let fixture: Fixture;
  let p: LLParse;

  beforeEach(() => {
    p = new LLParse();

    fixture = new Fixture({
      buildDir: TMP_DIR,
    });
  });

  it('should build with extra files', async () => {
    const start = p.node('start');
    const invoke = p.invoke(p.code.match('llparse__print_off'));

    start
      .match('a', start)
      .match('b', invoke)
      .otherwise(p.error(1, 'error'));

    invoke
      .otherwise(start);

    const build = fixture.build(p.build(start), 'extra', {
      extra: [ EXTRA_CODE ],
    });

    await build.check('abaaba', 'off=2\noff=5\n');
  });

  it('should normalize spans', async () => {
    const start = p.node('start');
    const sub = p.node('sub');
    const span = p.span(p.code.span('llparse__on_span'));

    start
      .match('a', start)
      .peek('b', span.start(sub))
      .otherwise(p.error(1, 'error'));

    sub
      .match('b', sub)
      .otherwise(span.end(start));

    const build = fixture.build(p.build(start), 'span', {
      extra: [ EXTRA_CODE ],
    });

    await build.check(
      'abbbaabba',
      'off=1 len=3 span[span]="bbb"\n' +
        'off=6 len=2 span[span]="bb"\n');
  });

  it('should print lf spans', async () => {
    const start = p.node('start');
    const sub = p.node('sub');
    const span = p.span(p.code.span('llparse__on_span'));

    start
      .match('a', start)
      .peek('b', span.start(sub))
      .otherwise(p.error(1, 'error'));

    sub
      .match([ 'b', '\r', '\n' ], sub)
      .otherwise(span.end(start));

    const build = fixture.build(p.build(start), 'span-lf', {
      extra: [ EXTRA_CODE ],
    });

    await build.check('abbb\nb\r\nbbbaabba', [
      'off=1 len=3 span[span]="bbb"',
      'off=4 len=1 span[span]=lf',
      'off=5 len=1 span[span]="b"',
      'off=6 len=1 span[span]=cr',
      'off=7 len=0 span[span]=""',
      'off=7 len=1 span[span]=lf',
      'off=8 len=3 span[span]="bbb"',
      'off=13 len=2 span[span]="bb"',
    ]);
  });

  it('should print errors', async () => {
    const start = p.node('start');

    start
      .match('a', start)
      .otherwise(p.error(1, 'some reason'));

    const build = fixture.build(p.build(start), 'error', {
      extra: [ EXTRA_CODE ],
    });

    await build.check(
      'aaab',
      'off=3 error code=1 reason="some reason"\n');
  });

  it('should check against regexp', async () => {
    const start = p.node('start');

    start
      .match('a', start)
      .otherwise(p.error(1, 'some reason'));

    const build = fixture.build(p.build(start), 'error', {
      extra: [ EXTRA_CODE ],
    });

    await build.check(
      'aaab',
      /off=\d+ error code=1 reason="some reason"/g);
  });

  it('should check against array of mixed strings/regexps', async () => {
    const start = p.node('start');
    const invoke = p.invoke(p.code.match('llparse__print_off'));

    start
      .skipTo(invoke.otherwise(start));

    const build = fixture.build(p.build(start), 'mixed', {
      extra: [ EXTRA_CODE ],
    });

    await build.check('aaab', [
      'off=1',
      'off=2',
      /off=\d/,
      'off=4',
    ]);
  });
});
