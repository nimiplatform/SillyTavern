#!/usr/bin/env node
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';
import path from 'node:path';
import { PUBLIC_DIRECTORIES } from './src/constants.js';

console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
// Shared mutable ST files live in business storage, never the sealed payload.
PUBLIC_DIRECTORIES.globalExtensions = path.join(cliArgs.dataRoot, 'shared-extensions');
PUBLIC_DIRECTORIES.backups = path.join(cliArgs.dataRoot, 'shared-backups');
process.chdir(serverDirectory);

try {
    await import('./src/server-main.js');
} catch (error) {
    console.error('A critical error has occurred while starting the server:', error);
}
