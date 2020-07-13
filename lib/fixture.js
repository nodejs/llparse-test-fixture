"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fixture = exports.ERROR_PAUSE = exports.FixtureResult = void 0;
const buffer_1 = require("buffer");
const child_process_1 = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const result_1 = require("./result");
Object.defineProperty(exports, "FixtureResult", { enumerable: true, get: function () { return result_1.FixtureResult; } });
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
            extra: options.extra || [],
            maxParallel: options.maxParallel === undefined ?
                os.cpus().length : options.maxParallel,
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
        const llvm = path.join(BUILD_DIR, name + '.ll');
        const c = path.join(BUILD_DIR, name + '.c');
        const header = path.join(BUILD_DIR, name + '.h');
        hash.update('header');
        hash.update(artifacts.header);
        await fs.promises.writeFile(header, artifacts.header);
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
            c: ['-I', BUILD_DIR],
        };
        if (artifacts.c !== undefined) {
            hash.update('c');
            hash.update(artifacts.c);
            await fs.promises.writeFile(c, artifacts.c);
            args.c.push(c);
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
        const executables = [];
        const out = path.join(BUILD_DIR, name + '-c.' + digest);
        const link = path.join(BUILD_DIR, name + '-c');
        if (!fs.existsSync(out)) {
            await this.clang(commonArgs.concat(args.c, '-o', out));
        }
        try {
            await fs.promises.unlink(link);
        }
        catch (e) {
            // no-op
        }
        await fs.promises.link(out, link);
        executables.push(out);
        return new result_1.FixtureResult(executables, this.options.maxParallel);
    }
    async clang(args) {
        const proc = child_process_1.spawn(CLANG, args, {
            stdio: [null, 'pipe', 'pipe'],
        });
        const stdout = [];
        proc.stdout.on('data', (chunk) => stdout.push(chunk));
        const stderr = [];
        proc.stderr.on('data', (chunk) => stderr.push(chunk));
        const code = await new Promise((resolve) => {
            proc.once('exit', (exitCode) => resolve(exitCode));
        });
        if (code !== 0) {
            if (stdout.length > 0) {
                process.stderr.write(buffer_1.Buffer.concat(stdout).toString());
            }
            if (stderr.length > 0) {
                process.stderr.write(buffer_1.Buffer.concat(stderr).toString());
            }
            const escapedArgs = args.map((arg) => JSON.stringify(arg));
            throw new Error('clang exit code: ' + code +
                `\narguments: ${escapedArgs.join(' ')}`);
        }
    }
}
exports.Fixture = Fixture;
//# sourceMappingURL=fixture.js.map