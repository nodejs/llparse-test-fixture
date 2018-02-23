'use strict';
/* globals describe it beforeEach */

// Test for a test, huh?

const path = require('path');
const llparse = require('llparse');

const Fixture = require('../');

const TMP_DIR = path.join(__dirname, 'tmp');
const EXTRA_CODE = path.join(__dirname, 'fixtures', 'extra.c');

describe('llparse-test-fixture', function() {
  this.timeout(10000);

  let fixture;
  let p;

  beforeEach(() => {
    p = llparse.create();

    fixture = new Fixture({
      buildDir: TMP_DIR
    });
  });

  it('should build with extra files', (callback) => {
    const start = p.node('start');
    const invoke = p.invoke(p.code.match('llparse__print_off'));

    start
      .match('a', start)
      .match('b', invoke)
      .otherwise(p.error(1, 'error'));

    invoke
      .otherwise(start);

    const build = fixture.build(p, start, 'extra', {
      extra: [ EXTRA_CODE ]
    });

    build('abaaba', 'off=2\noff=5\n', callback);
  });

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
});
