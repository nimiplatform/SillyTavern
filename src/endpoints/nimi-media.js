import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const router = express.Router();
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'video/mp4': 'mp4',
    'application/json': 'json', 'text/plain': 'txt' };
const recordId = value => { if (typeof value !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(value)) throw new Error('Invalid media record identity.'); return value; };
router.post('/save', async (req, res) => {
    try {
        const id = recordId(req.body.id);
        const root = path.join(req.user.directories.files, 'nimi-media');
        await fs.mkdir(root, { recursive: true });
        const assets = [];
        for (const artifact of req.body.artifacts || []) {
            const extension = extensions[artifact.mimeType];
            if (!extension || typeof artifact.base64 !== 'string' || artifact.base64.length > 128 * 1024 * 1024) throw new Error('Invalid generated media.');
            const bytes = Buffer.from(artifact.base64, 'base64');
            if (bytes.byteLength === 0 || bytes.byteLength !== artifact.sizeBytes) throw new Error('Generated media size mismatch.');
            const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
            if (artifact.sha256 && artifact.sha256.replace(/^sha256:/, '') !== sha256) throw new Error('Generated media digest mismatch.');
            const filename = `${sha256}.${extension}`;
            writeFileAtomicSync(path.join(root, filename), bytes);
            const metadata = { ...artifact };
            delete metadata.base64;
            assets.push({ ...metadata, sha256: `sha256:${sha256}`, url: `/user/files/nimi-media/${filename}` });
        }
        const file = path.join(root, `${id}.json`);
        let previous;
        try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const outputs = assets.filter(asset => asset.role !== 'input');
        const inputs = assets.filter(asset => asset.role === 'input');
        const record = { ...previous, ...req.body.record, id, assets: outputs.length ? outputs : previous?.assets || [],
            inputAssets: inputs.length ? inputs : previous?.inputAssets || [], updatedAt: new Date().toISOString() };
        writeFileAtomicSync(file, JSON.stringify(record));
        res.json(record);
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.get('/records', async (req, res) => {
    try {
        const root = path.join(req.user.directories.files, 'nimi-media');
        const names = await fs.readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        const records = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(root, name), 'utf8').then(JSON.parse)));
        res.json(records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (error) { res.status(500).json({ error: error.message }); }
});
