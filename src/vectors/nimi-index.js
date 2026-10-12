import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalIndex } from 'vectra';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

const locks = new Map();
const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
export function nimiIndexPath(root, collectionId, spaceId) {
    if (typeof collectionId !== 'string' || !collectionId || typeof spaceId !== 'string' || !spaceId) throw new Error('Collection and Runtime space identity are required.');
    return path.join(root, 'nimi', digest(collectionId), digest(spaceId));
}
export async function withNimiIndex(root, collectionId, spaceId, dimension, action) {
    if (!Number.isSafeInteger(dimension) || dimension < 1) throw new Error('Embedding dimension is required.');
    const folder = nimiIndexPath(root, collectionId, spaceId);
    const previous = locks.get(folder) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
        const store = new LocalIndex(folder);
        const metadataFile = path.join(folder, 'nimi-space.json');
        if (!await store.isIndexCreated()) {
            await store.createIndex();
            writeFileAtomicSync(metadataFile, JSON.stringify({ spaceId, collectionId, dimension }));
        }
        const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
        if (metadata.spaceId !== spaceId || metadata.collectionId !== collectionId || metadata.dimension !== dimension) throw new Error('The stored embedding space does not match this request. Explicit reindexing is required.');
        return action(store);
    });
    locks.set(folder, work);
    try { return await work; } finally { if (locks.get(folder) === work) locks.delete(folder); }
}
export function validateVector(vector, dimension) {
    if (!Array.isArray(vector) || vector.length !== dimension || vector.some(value => !Number.isFinite(value))) throw new Error('Invalid embedding vector.');
    return vector;
}
export async function updateNimiIndex(store, signal, action) {
    signal.throwIfAborted();
    await store.beginUpdate();
    try {
        await action();
        signal.throwIfAborted();
        await store.endUpdate();
    } catch (error) { store.cancelUpdate(); throw error; }
}
