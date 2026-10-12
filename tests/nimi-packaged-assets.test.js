import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import crypto from 'node:crypto';
import path from 'node:path';
import getWebpackServeMiddleware from '../src/middleware/webpack-serve.js';
import { serverDirectory } from '../src/server-directory.js';

describe('installed App static assets', () => {
    const originalPackaged = process.env.ST_NIMI_PACKAGED;
    const originalDataRoot = globalThis.DATA_ROOT;

    beforeEach(() => {
        process.env.ST_NIMI_PACKAGED = '1';
        globalThis.DATA_ROOT = serverDirectory;
        const createHash = crypto.createHash.bind(crypto);
        // Electron's crypto implementation does not offer this development
        // cache digest. Static serving must not ask for it in an installed App.
        jest.spyOn(crypto, 'createHash').mockImplementation((algorithm, options) => {
            if (algorithm === 'shake256') throw new Error('Digest method not supported');
            return createHash(algorithm, options);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalPackaged === undefined) delete process.env.ST_NIMI_PACKAGED;
        else process.env.ST_NIMI_PACKAGED = originalPackaged;
        if (originalDataRoot === undefined) delete globalThis.DATA_ROOT;
        else globalThis.DATA_ROOT = originalDataRoot;
    });

    test.each(['/style.css', '/script.js', '/scripts/nimi/platform.bundle.js'])('serves %s without evaluating the development cache', assetPath => {
        const next = jest.fn();
        const response = { sendFile: jest.fn() };
        expect(() => getWebpackServeMiddleware()({ method: 'GET', path: assetPath }, response, next)).not.toThrow();
        expect(next).toHaveBeenCalledTimes(1);
        expect(response.sendFile).not.toHaveBeenCalled();
        expect(crypto.createHash).not.toHaveBeenCalled();
    });

    test('maps the public library URL to the packaged build', () => {
        const next = jest.fn();
        const response = { sendFile: jest.fn() };
        getWebpackServeMiddleware()({ method: 'GET', path: '/lib.js' }, response, next);
        expect(response.sendFile).toHaveBeenCalledWith('lib.bundle.js', { root: path.join(serverDirectory, 'public') });
        expect(next).not.toHaveBeenCalled();
        expect(crypto.createHash).not.toHaveBeenCalled();
    });
});
