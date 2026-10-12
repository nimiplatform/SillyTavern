import os from 'node:os';
import path from 'node:path';

export function sillyTavernDataRoot() {
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'SillyTavern-Nimi');
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SillyTavern-Nimi');
    throw new Error('This SillyTavern Host requires macOS or Windows.');
}
