import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nimiIndexPath, withNimiIndex, updateNimiIndex } from '../src/vectors/nimi-index.js';

let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-nimi-vector-test-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const signal = () => new AbortController().signal;
test('same dimension never merges different Runtime spaces, including sanitized collisions', async () => {
    expect(nimiIndexPath(root, 'collection', 'space:/a')).not.toBe(nimiIndexPath(root, 'collection', 'space:?a'));
    await withNimiIndex(root, '资料', 'space:/a', 2, store => updateNimiIndex(store, signal(), () => store.insertItem({ vector: [1, 0], metadata: { hash: 1 } })));
    const items = await withNimiIndex(root, '资料', 'space:?a', 2, store => store.listItems());
    expect(items).toEqual([]);
});
test('cancellation rolls back the full batch', async () => {
    const controller = new AbortController();
    await expect(withNimiIndex(root, 'chat', 'space', 2, store => updateNimiIndex(store, controller.signal, async () => {
        await store.insertItem({ vector: [1, 0], metadata: { hash: 1 } }); controller.abort();
    }))).rejects.toThrow();
    expect(await withNimiIndex(root, 'chat', 'space', 2, store => store.listItems())).toEqual([]);
});
test('concurrent transactions serialize without losing items and retain metadata after reopening', async () => {
    await Promise.all([1, 2].map(hash => withNimiIndex(root, 'bank', 'runtime:opaque', 2, store => updateNimiIndex(store, signal(), () => store.insertItem({ vector: [1, hash], metadata: { hash, text: '真实资料' } })))));
    const items = await withNimiIndex(root, 'bank', 'runtime:opaque', 2, store => store.listItems());
    expect(items.map(item => item.metadata.hash).sort()).toEqual([1, 2]);
    await expect(withNimiIndex(root, 'bank', 'runtime:opaque', 3, () => null)).rejects.toThrow('space');
});
