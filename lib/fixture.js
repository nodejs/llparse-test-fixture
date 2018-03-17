"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const result_1 = require("./result");
const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';
const NATIVE_DIR = path.join(__dirname, '..', 'src', 'native');
const FIXTURE = path.join(NATIVE_DIR, 'fixture.c');
// Just a random value, really
exports.ERROR_PAUSE = 0x7fa73caa;
class Fixture {
    constructor(options) {
        this.options = {
            buildDir: options.buildDir,
            clang: options.clang === undefined ? CLANG : options.clang,
            extra: options.extra,
            maxParallel: options.maxParallel === undefined ?
                os.cpus().length : options.maxParallel,
        };
        try {
            fs.mkdirSync(this.options.buildDir);
        }
        catch (e) {
            // no-op
        }
    }
    build(artifacts, name, options = {}) {
        const BUILD_DIR = this.options.buildDir;
        const llvm = path.join(BUILD_DIR, name + '.ll');
        const bitcode = path.join(BUILD_DIR, name + '.bc');
        const header = path.join(BUILD_DIR, name + '.h');
        const out = path.join(BUILD_DIR, name);
        fs.writeFileSync(header, artifacts.header);
        let args = [
            '-g3', '-Os', '-fvisibility=hidden'
        ];
        // This is rather lame, but should work
        if (CFLAGS) {
            args = args.concat(CFLAGS.split(/\s+/g));
        }
        args = args.concat([
            '-include', header, '-I', NATIVE_DIR,
            FIXTURE
        ]);
        if (artifacts.llvm !== undefined) {
            fs.writeFileSync(llvm, artifacts.llvm);
            args.push(llvm);
        }
        else if (artifacts.bitcode !== undefined) {
            fs.writeFileSync(bitcode, artifacts.bitcode);
            args.push(bitcode);
        }
        if (this.options.extra) {
            args = args.concat(this.options.extra);
        }
        if (options.extra) {
            args = args.concat(options.extra);
        }
        args.push('-o', out);
        const ret = child_process_1.spawnSync(CLANG, args);
        if (ret.status !== 0) {
            if (ret.stdout)
                process.stderr.write(ret.stdout);
            if (ret.stderr)
                process.stderr.write(ret.stderr);
            if (ret.error)
                throw ret.error;
            throw new Error('clang exit code: ' + (ret.status || ret.signal));
        }
        return new result_1.FixtureResult(out, this.options.maxParallel);
    }
}
exports.Fixture = Fixture;
//# sourceMappingURL=fixture.js.map