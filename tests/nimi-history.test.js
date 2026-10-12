import { webcrypto } from 'node:crypto';
import { attachReceipt, attachCandidateReceipts, resultReceipt, resetNimiReplay, restoreTurnItems } from '../public/scripts/nimi/history.js';
import { toNimiMessages, requireCompleteText, combineInitialSystemParagraphs, assertUserHistoryRetained } from '../public/scripts/nimi/model-input.js';

globalThis.crypto = webcrypto;
const carrier = byte => ({ type: 'reasoning-continuity', carrier: { kind: 'test.opaque', version: 1, payload: new Uint8Array([byte, 0, 255]) } });
function receipt(text, byte = 1) { return resultReceipt({ text, finishReason: 'stop', outputItems: [{ type: 'text', text }, carrier(byte)] }, 'resource', { epoch: 1, key: 'chat' }); }

test('intentional first-turn context does not mask budget-truncated user history', () => {
    const firstTurn = [{ role: 'system', content: '角色规则' }, { role: 'assistant', content: '角色的真实首句' }];
    const unchanged = structuredClone(firstTurn);
    expect(() => assertUserHistoryRetained(false, firstTurn)).not.toThrow();
    expect(() => assertUserHistoryRetained(true, firstTurn)).toThrow('prompt budget removed all user history');
    expect(() => assertUserHistoryRetained(true, [...firstTurn, { role: 'user', content: 'Actual request' }])).not.toThrow();
    expect(firstTurn).toEqual(unchanged);
});

test('preserves independent systems in historical positions and Unicode/whitespace', async () => {
    const messages = [{ role: 'system', content: '主指令\n\n' }, { role: 'system', content: '角色' }, { role: 'user', content: '你好' },
        { role: 'system', content: '世界书 atDepth' }, { role: 'assistant', content: '  回复\n' }, { role: 'system', content: 'Author\'s Note' }];
    const result = await toNimiMessages(messages);
    expect(result.map(message => message.role)).toEqual(messages.map(message => message.role));
    expect(result[0].content[0].text).toBe('主指令\n\n');
    expect(result[4].turnItems[0].output.text).toBe('  回复\n');
});
test('a manual edit drops opaque replay while retaining the original result', async () => {
    const source = receipt('original');
    const result = await toNimiMessages([{ role: 'assistant', content: 'edited', nimi: source }]);
    expect(result[0].turnItems).toEqual([{ type: 'output', output: { type: 'text', text: 'edited' } }]);
    expect(source.result.text).toBe('original');
    expect(source.replayReset).toBe(true);
});
test('combines only initial system paragraphs, leaving positioned history intact', async () => {
    const messages = await toNimiMessages([{ role: 'system', content: '  角色\n' }, { role: 'system', content: '[Start a new Chat]' },
        { role: 'user', content: '你好' }, { role: 'system', content: '世界书 atDepth' }, { role: 'system', content: "Author's Note" }]);
    const combined = combineInitialSystemParagraphs(messages);
    expect(combined[0].content[0].text).toBe('  角色\n\n\n[Start a new Chat]');
    expect(combined.slice(1)).toEqual(messages.slice(2));
    expect(messages).toHaveLength(5);
});
test('each candidate has its own canonical output and opaque bytes', () => {
    const message = { mes: 'A', extra: {}, swipe_id: 0, swipes: ['A', 'B'], swipe_info: [{ extra: {} }, { extra: {} }] };
    const a = receipt('A', 1); const b = receipt('B', 2);
    attachReceipt(message, a); attachCandidateReceipts(message, [a, b]);
    expect(message.extra.nimi.id).toBe(a.id);
    expect(message.swipe_info[1].extra.nimi.id).toBe(b.id);
    expect(message.swipe_info[1].extra.nimi.turnItems[1].output.carrier.payload[0]).toBe(2);
});
test('continue keeps separate actual turns and never resurrects reset continuity', async () => {
    const previous = receipt('A', 1);
    const message = { mes: 'A', extra: { nimi: previous } };
    resetNimiReplay([message]);
    message.mes = 'AB';
    attachReceipt(message, receipt('B', 2), { continuation: true, previousText: 'A', previousReceipt: previous });
    const projected = await toNimiMessages([{ role: 'assistant', content: 'AB', nimi: message.extra.nimi }]);
    expect(projected[0].turnItems.filter(item => item.output.type === 'reasoning-continuity').map(item => item.output.carrier.payload[0])).toEqual([2]);
    expect(previous.outputItems[1].carrier.payload).toEqual([1, 0, 255]);
});
test('continue after editing uses explicit text context and the new actual output', async () => {
    const previous = receipt('old'); const message = { mes: 'new tail', extra: {} };
    attachReceipt(message, receipt(' tail', 2), { continuation: true, previousText: 'new', previousReceipt: previous });
    const result = await toNimiMessages([{ role: 'assistant', content: message.mes, nimi: message.extra.nimi }]);
    expect(result[0].turnItems.filter(item => item.output.type === 'text').map(item => item.output.text).join('')).toBe('new tail');
    expect(result[0].turnItems.filter(item => item.output.type === 'reasoning-continuity')).toHaveLength(1);
});
test('preserves canonical tool/result IDs, order, null result and error', async () => {
    const outputItems = [{ type: 'tool-call', toolCall: { id: 'first', name: 'a', arguments: {} } }, { type: 'tool-call', toolCall: { id: 'second', name: 'b', arguments: {} } }];
    const source = resultReceipt({ text: '', finishReason: 'tool-calls', outputItems }, 'resource', {});
    const result = await toNimiMessages([{ role: 'assistant', nimi: source, content: '', tool_calls: outputItems.map(item => ({ id: item.toolCall.id, function: { name: item.toolCall.name, arguments: '{}' } })) },
        { role: 'tool', tool_call_id: 'first', content: '[No content]', nimiToolResult: { result: null } },
        { role: 'tool', tool_call_id: 'second', content: 'failure', nimiToolResult: { result: 'failure', isError: true } }]);
    expect(result[0].turnItems.map(item => item.output.toolCall.id)).toEqual(['first', 'second']);
    expect(result[1].turnItems[0].toolResult).toEqual({ toolCallId: 'first', toolName: 'a', result: null });
    expect(result[2].turnItems[0].toolResult.isError).toBe(true);
});
test('incomplete tools and malformed opaque bytes fail closed', () => {
    expect(() => requireCompleteText({ text: '', finishReason: 'length', outputItems: [{ type: 'tool-call', toolCall: { id: 'a' } }] })).toThrow();
    expect(() => restoreTurnItems([{ type: 'output', output: { type: 'reasoning-continuity', carrier: { payload: [-1] } } }])).toThrow();
});
