"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const result_1 = require("./result");
exports.FixtureResult = result_1.FixtureResult;
const CLANG = process.env.CLANG || 'clang';
const CFLAGS = process.env.CFLAGS || '';
const NATIVE_DIR = path.join(__dirname, '..', 'src', 'native');
const FIXTURE = path.join(NATIVE_DIR, 'fixture.c');
const JS_RUNNER = path.join(__dirname, '..', 'bin', 'llparse-test.js');
// Just a random value, really
exports.ERROR_PAUSE = 0x7fa73caa;
class Fixture {
    constructor(options) {
        this.options = {
            buildDir: options.buildDir,
            clang: options.clang === undefined ? CLANG : options.clang,
            extra: options.extra || [],
            extraJS: options.extraJS || [],
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
        const hash = crypto.createHash('sha256');
        const llvm = path.join(BUILD_DIR, name + '.ll');
        const bitcode = path.join(BUILD_DIR, name + '.bc');
        const c = path.join(BUILD_DIR, name + '.c');
        const js = path.join(BUILD_DIR, name + '.js');
        const header = path.join(BUILD_DIR, name + '.h');
        hash.update('header');
        hash.update(artifacts.header);
        fs.writeFileSync(header, artifacts.header);
        const commonArgs = [
            '-g3', '-Os', '-fvisibility=hidden',
            '-I', NATIVE_DIR,
            '-include', header,
            FIXTURE,
        ];
        // This is rather lame, but should work
        if (CFLAGS) {
            for (const flag of CFLAGS.split(/\s+/g)) {
                commonArgs.push(flag);
            }
        }
        const args = {
            bitcode: [],
            c: ['-I', BUILD_DIR],
            js: [],
        };
        if (artifacts.llvm !== undefined) {
            hash.update('llvm');
            hash.update(artifacts.llvm);
            fs.writeFileSync(llvm, artifacts.llvm);
            args.bitcode.push(llvm);
        }
        else if (artifacts.bitcode !== undefined) {
            hash.update('bitcode');
            hash.update(artifacts.bitcode);
            fs.writeFileSync(bitcode, artifacts.bitcode);
            args.bitcode.push(bitcode);
        }
        if (artifacts.c !== undefined) {
            hash.update('c');
            hash.update(artifacts.c);
            fs.writeFileSync(c, artifacts.c);
            args.c.push(c);
        }
        const extraJS = this.options.extraJS.concat(options.extraJS || []);
        const initJS = options.initJS || this.options.initJS;
        if (artifacts.js !== undefined) {
            hash.update('js');
            hash.update(artifacts.js);
            fs.writeFileSync(js, artifacts.js);
            args.js.push(js);
            hash.update('extra-js');
            hash.update(extraJS.join(' '));
            if (initJS) {
                hash.update('init-js');
                hash.update(initJS);
            }
        }
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
        const out = path.join(BUILD_DIR, name + '.' + digest);
        const link = path.join(BUILD_DIR, name);
        const executables = [];
        if (!fs.existsSync(out)) {
            // Compile binary, no cached version available
            this.clang(commonArgs.concat(args.bitcode, '-o', out));
        }
        try {
            fs.unlinkSync(link);
        }
        catch (e) {
            // no-op
        }
        fs.linkSync(out, link);
        executables.push(link);
        if (artifacts.c !== undefined) {
            const cOut = path.join(BUILD_DIR, name + '-c.' + digest);
            const cLink = path.join(BUILD_DIR, name + '-c');
            if (!fs.existsSync(cOut)) {
                this.clang(commonArgs.concat(args.c, '-o', cOut));
            }
            try {
                fs.unlinkSync(cLink);
            }
            catch (e) {
                // no-op
            }
            fs.linkSync(cOut, cLink);
            executables.push(cLink);
        }
        if (artifacts.js !== undefined) {
            const jsOut = path.join(BUILD_DIR, name + '-js');
            const jsArgs = [
                `-p ${path.resolve(js).replace(/(\s+)/g, '\\$1')}`,
            ];
            for (const extra of extraJS) {
                jsArgs.push(`-b ${path.resolve(extra).replace(/(\s+)/g, '\\$1')}`);
            }
            if (initJS) {
                jsArgs.push(`-i ${initJS}`);
            }
            fs.writeFileSync(jsOut, '#!/bin/sh\n' +
                `${JS_RUNNER.replace(/(\s+)/g, '\\$1')} ${jsArgs.join(' ')} "$1" "$2"`);
            fs.chmodSync(jsOut, 0o775);
            executables.push(jsOut);
        }
        return new result_1.FixtureResult(executables, this.options.maxParallel);
    }
    clang(args) {
        const ret = child_process_1.spawnSync(CLANG, args);
        if (ret.status !== 0) {
            if (ret.stdout) {
                process.stderr.write(ret.stdout);
            }
            if (ret.stderr) {
                process.stderr.write(ret.stderr);
            }
            if (ret.error) {
                throw ret.error;
            }
            const escapedArgs = args.map((arg) => JSON.stringify(arg));
            throw new Error('clang exit code: ' + (ret.status || ret.signal) +
                `\narguments: ${escapedArgs.join(' ')}`);
        }
    }
}
exports.Fixture = Fixture;
//# sourceMappingURL=fixture.js.map