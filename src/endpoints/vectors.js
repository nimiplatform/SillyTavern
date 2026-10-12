import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { withNimiIndex, updateNimiIndex, validateVector } from '../vectors/nimi-index.js';

export const router = express.Router();
router.use((req, res, next) => {
    if (req.body.source && req.body.source !== 'nimi') return res.status(410).json({ error: 'Provider embeddings have retired; use Nimi text.embed.' });
    next();
});
function interrupted(req, res) {
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    return controller.signal;
}
function index(req, collectionId, action) {
    return withNimiIndex(req.user.directories.vectors, collectionId, req.body.spaceId, req.body.dimension, action);
}
function respond(handler) {
    return async (req, res) => {
        try { const result = await handler(req, res); if (!res.headersSent && !res.destroyed) res.json(result ?? {}); } catch (error) { if (!res.destroyed) res.status(400).json({ error: error.message }); }
    };
}
router.post('/insert', respond(async (req, res) => {
    const { items, vectors, dimension } = req.body;
    if (!Array.isArray(items) || !Array.isArray(vectors) || items.length !== vectors.length || !items.length) throw new Error('Embedding batch cardinality mismatch.');
    const batch = items.map((item, i) => {
        if (!Number.isFinite(item.hash) || typeof item.text !== 'string' || !Number.isSafeInteger(item.index)) throw new Error('Invalid vector item.');
        return { vector: validateVector(vectors[i], dimension), metadata: { hash: item.hash, text: item.text, index: item.index } };
    });
    const signal = interrupted(req, res);
    await index(req, req.body.collectionId, store => updateNimiIndex(store, signal, async () => {
        for (const item of batch) { signal.throwIfAborted(); await store.upsertItem(item); }
    }));
}));
router.post('/list', respond(req => index(req, req.body.collectionId, async store => (await store.listItems()).map(item => Number(item.metadata.hash)))));
router.post('/delete', respond(async (req, res) => {
    if (!Array.isArray(req.body.hashes) || req.body.hashes.some(hash => !Number.isFinite(hash))) throw new Error('Invalid hashes.');
    const signal = interrupted(req, res);
    await index(req, req.body.collectionId, async store => {
        const items = await store.listItemsByMetadata({ hash: { '$in': req.body.hashes } });
        await updateNimiIndex(store, signal, async () => { for (const item of items) { signal.throwIfAborted(); await store.deleteItem(item.id); } });
    });
}));
async function query(req, collectionId) {
    const vector = validateVector(req.body.vectors?.[0], req.body.dimension);
    const topK = req.body.topK ?? 10;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 10000) throw new Error('Invalid retrieval count.');
    return index(req, collectionId, store => store.queryItems(vector, topK));
}
router.post('/query', respond(async req => {
    const results = (await query(req, req.body.collectionId)).filter(result => result.score >= (req.body.threshold ?? 0));
    return { hashes: results.map(result => Number(result.item.metadata.hash)), metadata: results.map(result => result.item.metadata) };
}));
router.post('/query-multi', respond(async req => {
    if (!Array.isArray(req.body.collectionIds)) throw new Error('Collections are required.');
    const results = [];
    for (const collectionId of req.body.collectionIds) for (const result of await query(req, collectionId)) results.push({ collectionId, result });
    const selected = results.filter(item => item.result.score >= (req.body.threshold ?? 0)).sort((a, b) => b.result.score - a.result.score).slice(0, req.body.topK ?? 10);
    const grouped = {};
    for (const { collectionId, result } of selected) { grouped[collectionId] ??= { hashes: [], metadata: [] }; grouped[collectionId].hashes.push(Number(result.item.metadata.hash)); grouped[collectionId].metadata.push(result.item.metadata); }
    return grouped;
}));
router.post('/purge', respond(async req => {
    if (typeof req.body.collectionId !== 'string' || !req.body.collectionId) throw new Error('Collection is required.');
    const key = crypto.createHash('sha256').update(req.body.collectionId, 'utf8').digest('hex');
    await fs.rm(path.join(req.user.directories.vectors, 'nimi', key), { recursive: true, force: true });
}));
router.post('/purge-all', respond(async req => { await fs.rm(path.join(req.user.directories.vectors, 'nimi'), { recursive: true, force: true }); }));
