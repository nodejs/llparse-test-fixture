"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fixture = exports.ERROR_PAUSE = exports.FixtureResult = void 0;
const node_child_process_1 = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const result_1 = require("./result");
Object.defineProperty(exports, "FixtureResult", { enumerable: true, get: function () { return result_1.FixtureResult; } });
const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';
const WASM = process.env.WASM;
const WASM_CFLAGS = process.env.WASM_CFLAGS || '';
const NATIVE_DIR = path.join(__dirname, '..', 'src', 'native');
const FIXTURE = path.join(NATIVE_DIR, 'fixture.c');
// Just a random value, really
exports.ERROR_PAUSE = 0x7fa73caa;
class Fixture {
    options;
    constructor(options) {
        this.options = {
            buildDir: options.buildDir,
            clang: options.clang === undefined ? CLANG : options.clang,
            wasm: options.wasm === undefined ? WASM : options.wasm,
            extra: options.extra || [],
            maxParallel: options.maxParallel === undefined ?
                os.cpus().length :
                options.maxParallel,
        };
        try {
            fs.mkdirSync(this.options.buildDir, { recursive: true });
        }
        catch (e) {
            // no-op
        }
    }
    async build(artifacts, name, options = {}) {
        const BUILD_DIR = this.options.buildDir;
        const hash = crypto.createHash('sha256');
        const c = path.join(BUILD_DIR, name + '.c');
        const header = path.join(BUILD_DIR, name + '.h');
        hash.update('header');
        hash.update(artifacts.header);
        await fs.promises.writeFile(header, artifacts.header);
        const commonArgs = [
            '-g3', '-Os', '-fvisibility=hidden',
            '-I', NATIVE_DIR,
            '-I', BUILD_DIR,
            '-include', header,
            FIXTURE,
        ];
        const args = {
            c: ['-msse4.2'],
            wasm: [
                '-msimd128',
                '-fno-exceptions',
                '-mexec-model=reactor',
                '-Wl,-error-limit=0',
                '-Wl,--allow-undefined',
                '-Wl,--export-dynamic',
                '-Wl,--export-table',
                '-Wl,--export=malloc',
                '-Wl,--export=free',
                '-Wl,--no-entry',
            ],
        };
        // This is rather lame, but should work
        if (CFLAGS) {
            for (const flag of CFLAGS.split(/\s+/g)) {
                args.c.push(flag);
            }
        }
        if (WASM_CFLAGS) {
            for (const flag of WASM_CFLAGS.split(/\s+/g)) {
                args.wasm.push(flag);
            }
        }
        hash.update('c');
        hash.update(artifacts.c);
        await fs.promises.writeFile(c, artifacts.c);
        args.c.push(c);
        args.wasm.push(c);
        for (const extra of this.options.extra) {
            commonArgs.push(extra);
        }
        if (options.extra) {
            for (const extra of options.extra) {
                commonArgs.push(extra);
            }
        }
        hash.update('common-args');
        hash.update(commonArgs.join(' '));
        const digest = hash.digest('hex');
        const executables = [];
        {
            const out = path.join(BUILD_DIR, name + '-c.' + digest);
            const link = path.join(BUILD_DIR, name + '-c');
            if (!fs.existsSync(out)) {
                await this.clang(this.options.clang, commonArgs.concat(args.c, '-o', out));
            }
            try {
                await fs.promises.unlink(link);
            }
            catch (e) {
                // no-op
            }
            await fs.promises.link(out, link);
            executables.push(out);
        }
        if (this.options.wasm) {
            const out = path.join(BUILD_DIR, name + '-' + digest + '.wasm');
            const link = path.join(BUILD_DIR, name + '.wasm');
            if (!fs.existsSync(out)) {
                await this.clang(this.options.wasm, commonArgs.concat(args.wasm, '-o', out));
            }
            try {
                await fs.promises.unlink(link);
            }
            catch (e) {
                // no-op
            }
            await fs.promises.link(out, link);
            executables.push(out);
        }
        return new result_1.FixtureResult(executables, this.options.maxParallel);
    }
    async clang(bin, args) {
        const proc = (0, node_child_process_1.spawn)(bin, args, {
            stdio: [null, 'pipe', 'pipe'],
        });
        const stdout = [];
        proc.stdout.on('data', (chunk) => stdout.push(chunk));
        const stderr = [];
        proc.stderr.on('data', (chunk) => stderr.push(chunk));
        const code = await new Promise((resolve) => {
            proc.once('exit', exitCode => resolve(exitCode));
        });
        if (code !== 0) {
            if (stdout.length > 0) {
                process.stderr.write(Buffer.concat(stdout).toString());
            }
            if (stderr.length > 0) {
                process.stderr.write(Buffer.concat(stderr).toString());
            }
            const escapedArgs = args.map(arg => JSON.stringify(arg));
            throw new Error('clang exit code: ' + code +
                `\narguments: ${escapedArgs.join(' ')}`);
        }
    }
}
exports.Fixture = Fixture;
//# sourceMappingURL=fixture.js.map