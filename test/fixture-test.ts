// Test for a test, huh?

import * as path from 'path';
import { Builder, Compiler } from 'llparse-compiler';

import { Fixture } from '../src/fixture';

const TMP_DIR = path.join(__dirname, 'tmp');
const EXTRA_CODE = path.join(__dirname, 'fixtures', 'extra.c');

describe('llparse-test-fixture', function() {
  this.timeout(10000);

  let fixture: Fixture;
  let c: Compiler;
  let p: Builder;

  beforeEach(() => {
    c = new Compiler();
    p = c.createBuilder();

    fixture = new Fixture({
      buildDir: TMP_DIR
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

    const art = c.compile(start, p.properties);
    const build = fixture.build(art, 'extra', {
      extra: [ EXTRA_CODE ]
    });

    await build.check('abaaba', 'off=2\noff=5\n');
  });

  /*
  it('should normalize spans', (callback) => {
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

    const build = fixture.build(p, start, 'span', {
      extra: [ EXTRA_CODE ]
    });

    build(
      'abbbaabba',
      'off=1 len=3 span[span]="bbb"\n' +
        'off=6 len=2 span[span]="bb"\n',
      callback);
  });

  it('should print errors', (callback) => {
    const start = p.node('start');

    start
      .match('a', start)
      .otherwise(p.error(1, 'some reason'));

    const build = fixture.build(p, start, 'error', {
      extra: [ EXTRA_CODE ]
    });

    build(
      'aaab',
      'off=3 error code=1 reason="some reason"\n',
      callback);
  });

  it('should check against regexp', (callback) => {
    const start = p.node('start');

    start
      .match('a', start)
      .otherwise(p.error(1, 'some reason'));

    const build = fixture.build(p, start, 'error', {
      extra: [ EXTRA_CODE ]
    });

    build(
      'aaab',
      /off=\d+ error code=1 reason="some reason"/g,
      callback);
  });

  it('should check against array of mixed strings/regexps', (callback) => {
    const start = p.node('start');
    const invoke = p.invoke(p.code.match('llparse__print_off'));

    start
      .skipTo(invoke.otherwise(start));

    const build = fixture.build(p, start, 'mixed', {
      extra: [ EXTRA_CODE ]
    });

    build('aaab', [
      'off=1',
      'off=2',
      /off=\d/,
      'off=4'
    ], callback);
  });
  */
});
