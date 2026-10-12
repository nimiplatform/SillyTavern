import { createToolEffects, assertToolEffectMayRun } from '../public/scripts/nimi/tool-effects.js';
import { updateStoredToolEffects } from '../src/nimi-tool-effects.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('callbacks must match completed canonical tool IDs and arguments', () => {
    const receipt = { id: 'turn', outputItems: [{ type: 'tool-call', toolCall: { id: 'id', name: 'write', arguments: { text: '中文' } } }] };
    expect(() => createToolEffects(receipt, [{ id: 'wrong', function: { name: 'write', arguments: '{"text":"中文"}' } }])).toThrow();
});
test('unknown effects cannot be retried even if a later model reuses the call ID', () => {
    const effect = { id: 'call-0', name: 'write', parameters: '{"b":2,"a":1}' };
    const history = [{ effects: [{ id: 'call-0', name: 'write', parameters: '{"a":1,"b":2}', status: 'unconfirmed' }] }];
    expect(() => assertToolEffectMayRun(effect, history)).toThrow('not retried');
});
test('late callback updates its exact original receipt without overwriting an intervening text edit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-nimi-effect-test-'));
    try {
        const folder = path.join(root, 'chats', '角色'); fs.mkdirSync(folder, { recursive: true });
        const plan = { id: 'turn', effects: [{ id: 'call', name: 'write', parameters: '{}', status: 'running' }] };
        const file = path.join(folder, 'old.jsonl');
        fs.writeFileSync(file, JSON.stringify({ mes: 'User edited this text', extra: { nimiEffects: plan } }));
        plan.effects[0] = { ...plan.effects[0], status: 'completed', result: '实际结果' };
        updateStoredToolEffects({ chats: path.join(root, 'chats') }, { avatar: '角色.png', chatId: 'old', group: false }, plan);
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(saved.mes).toBe('User edited this text');
        expect(saved.extra.tool_invocations[0].result).toBe('实际结果');
        expect(() => updateStoredToolEffects({ chats: path.join(root, 'chats') }, { avatar: '角色.png', chatId: 'old', group: false }, { ...plan, id: 'different' })).toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
