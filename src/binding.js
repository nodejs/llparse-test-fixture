import { format } from 'node:util';

export default (binding, inBench) => {
  // Just a random value, really
  binding.LLPARSE__ERROR_PAUSE = 0x7fa73caa;

  let globalOff = 0;
  binding.setGlobalOff = (value) => globalOff = value;

  const translate = (off) => off + globalOff;

  const nop = () => 0;
  binding.llparse__print = inBench ? nop : (off, fmt, ...params) => {
    const parts = [
      format('off=%d', translate(off)),
      format(fmt, ...params),
    ];
    console.log(parts.join(' ').trim());
    return 0;
  };

  binding.llparse__print_span = inBench ? nop : (name, buf, off, end) => {
    let last = off;

    const printRegular = (current) => {
      if (last !== current) {
        binding.llparse__print(last, 'len=%d span[%s]="%s"',
          current - last, name, buf.slice(last, current).toString());
      }
    };

    // Empty span
    if (off === end) {
      binding.llparse__print(off, 'len=0 span[%s]=""', name);
      return 0;
    }

    for (let i = off; i < end; i++) {
      const ch = buf[i];

      if (ch === 0xd) {
        printRegular(i);

        binding.llparse__print(i, 'len=1 span[%s]=cr', name);
        last = i + 1;
        continue;

        // LF
      } else if (ch === 0xa) {
        printRegular(i);

        binding.llparse__print(i, 'len=1 span[%s]=lf', name);
        last = i + 1;
        continue;
      }

      // Nothing to do here
    }

    // Trailing data
    printRegular(end);

    return 0;
  };

  binding.debug = inBench ? nop : (_, buf, off, msg) => {
    if (off === buf.length) {
      // tslint:disable-next-line:no-console
      console.error(format('off=%d next=null debug=%s', translate(off), msg));
    } else {
      let next = buf[off + 1].toString(16);
      if (next.length < 2) {
        next = '0' + next;
      }
      // tslint:disable-next-line:no-console
      console.error(format('off=%d next=%s debug=%s', translate(off),
        next, msg));
    }
  };
};
