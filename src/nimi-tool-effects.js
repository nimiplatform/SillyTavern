import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

export function updateStoredToolEffects(directories, target, plan) {
    if (typeof target.chatId !== 'string' || !target.chatId || typeof plan.id !== 'string' || !Array.isArray(plan.effects)) throw new Error('A saved chat and exact tool receipt are required.');
    const root = target.group ? directories.groupChats : directories.chats;
    if (!target.group && (typeof target.avatar !== 'string' || sanitize(target.avatar) !== target.avatar)) throw new Error('Invalid character avatar.');
    const file = target.group ? path.join(root, sanitize(`${target.chatId}.jsonl`))
        : path.join(root, target.avatar.replace('.png', ''), sanitize(`${target.chatId}.jsonl`));
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const message = rows.find(row => row.extra?.nimiEffects?.id === plan.id);
    if (!message) throw new Error('The original tool receipt is no longer present in this chat.');
    const prior = message.extra.nimiEffects;
    if (prior.effects.length !== plan.effects.length || prior.effects.some((effect, index) => effect.id !== plan.effects[index].id || effect.name !== plan.effects[index].name || effect.parameters !== plan.effects[index].parameters)) throw new Error('Tool receipt identity cannot change.');
    message.extra.nimiEffects = plan;
    message.extra.tool_invocations = plan.effects.map(effect => ({ id: effect.id, name: effect.name, displayName: effect.name, parameters: effect.parameters,
        result: effect.status === 'completed' ? effect.result : effect.status === 'failed' ? effect.error : JSON.stringify({ status: effect.status, message: 'Outcome not confirmed; not automatically retried.' }), error: effect.status !== 'completed' }));
    writeFileAtomicSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
}
