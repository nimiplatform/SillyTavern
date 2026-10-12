import path from 'node:path';
import fs from 'node:fs';
import { sillyTavernDataRoot } from './nimi-data-root.mjs';
import { serverEvents, EVENT_NAMES } from '../src/server-events.js';

const root = sillyTavernDataRoot();
fs.mkdirSync(root, { recursive: true });
process.argv = [process.execPath, path.resolve('server.js'),
    '--dataRoot', root, '--configPath', path.join(root, 'config.yaml'),
    '--port', '1476', '--listen', 'false', '--enableIPv6', 'false',
    '--enableIPv4', 'true', '--browserLaunchEnabled', 'false'];
serverEvents.once(EVENT_NAMES.SERVER_STARTED, ({ url }) => {
    process.parentPort?.postMessage({ type: 'sillytavern-ready', url: url.toString() });
});
await import('../server.js');
