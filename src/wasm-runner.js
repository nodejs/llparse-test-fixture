const fs = require('node:fs');

async function main() {
  const [, , wasmPath, spec, input] = process.argv;
  console.error(wasmPath);

  const wasm = fs.readFileSync(wasmPath);

  const mod = await WebAssembly.compile(wasm)
  const { exports: { malloc, run, memory } } = await WebAssembly.instantiate(mod, {
    wasi_snapshot_preview1: {
      fd_write: () => {
        throw new Error('not implemented');
      },
      fd_seek: () => {
        throw new Error('not implemented');
      },
      fd_close: () => {
        throw new Error('not implemented');
      },
    },
    env: {
      wasm_print: (stream, ptr) => {
        const start = Buffer.from(memory.buffer).slice(ptr);
        const end = start.indexOf(0);
        const str = start.slice(0, end).toString();
        if (stream === 0) {
          process.stdout.write(str);
        } else {
          process.stderr.write(str);
        }
      },
      wasm_get_time: () => Date.now(),
    }
  });

  function str(value) {
    const buf = Buffer.from(value);
    const ptr = malloc(buf.byteLength + 1);
    new Uint8Array(memory.buffer, ptr, buf.byteLength + 1).set(buf);
    return ptr;
  }

  run(str('wasm'), str(spec), input ? str(input) : 0);
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
