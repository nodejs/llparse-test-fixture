import { Buffer } from 'buffer';

export default (binding, inBench) => {
  const nop = () => 0;

  binding.llparse__print_off = inBench ? nop : (_, buf, off) => {
    binding.llparse__print(off, '');
    return 0;
  };

  binding.llparse__on_span = inBench ? nop : (_, buf, off, offLen) => {
    return binding.llparse__print_span('span', buf, off, offLen);
  };
};
