import { build } from 'esbuild';
import webpack from 'webpack';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import getPublicLibConfig from '../webpack.config.js';

await build({ entryPoints: ['public/scripts/nimi/platform.jsx'], outfile: 'public/scripts/nimi/platform.bundle.js',
    bundle: true, platform: 'browser', target: 'chrome130', format: 'esm', minify: true });
await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'exec', 'tailwindcss', '-i', 'public/scripts/nimi/config.css', '-o', 'public/css/nimi-kit.css', '--minify'], { stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Kit CSS build failed (${code}).`)));
});
const config = getPublicLibConfig({ forceDist: true });
const compiler = webpack(config);
await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error || stats?.hasErrors()) reject(error || new Error(stats.toString('errors-only')));
    else resolve();
}));
await fs.copyFile(`${config.output.path}/lib.js`, 'public/lib.bundle.js');
