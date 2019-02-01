import { Buffer } from 'buffer';

export default (binding: any, inBench: boolean) => {
  const nop = () => 0;

  binding.llparse__print_off = inBench ? nop :
    (_: any, buf: Buffer, off: number) => {
      binding.llparse__print(off, '');
      return 0;
    };

  binding.llparse__on_span = inBench ? nop :
    (_: any, buf: Buffer, off: number, offLen: number) => {
      return binding.llparse__print_span('span', buf, off, offLen);
    };
};
