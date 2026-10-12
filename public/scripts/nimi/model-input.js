import { restoreTurnItems, serializeNimi, resolveNimiReceipt } from './history.js';

export function assertUserHistoryRetained(hadUserHistory, messages) {
    if (hadUserHistory && !messages.some(message => message.role === 'user')) {
        throw new Error('The prompt budget removed all user history. Increase the context budget or explicitly start a new chat; the original conversation was not rewritten.');
    }
}

export function functionCall(call) {
    if (!call?.id || !call.function?.name) throw new Error('Tool call requires its original ID and name.');
    return { id: call.id, name: call.function.name, arguments: typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments };
}
export function textOf(content) {
    if (typeof content === 'string') return content;
    if (content == null) return '';
    if (!Array.isArray(content)) throw new Error('Invalid SillyTavern message content.');
    return content.filter(part => part.type === 'text').map(part => part.text).join('');
}
// ST's initial instruction blocks are paragraphs in the same system context.
// Only the consecutive prefix can be combined; atDepth/Author's Note/history
// systems keep their original positions and still require exact Driver support.
export function combineInitialSystemParagraphs(messages) {
    let end = 0;
    while (messages[end]?.role === 'system') end++;
    if (end < 2) return messages;
    const prefix = messages.slice(0, end);
    if (prefix.some(message => message.turnItems?.length || message.content.some(part => part.type !== 'text'))) return messages;
    return [{ role: 'system', content: [{ type: 'text', text: prefix.map(message => message.content.map(part => part.text).join('')).join('\n\n') }] }, ...messages.slice(end)];
}
export async function toNimiMessages(messages, uploadMedia) {
    const calls = new Map();
    const result = [];
    for (const message of messages) {
        if (!message || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Unsupported SillyTavern message role.');
        if (message.name) throw new Error('Native named messages are not admitted by this Nimi workflow. The original name setting is preserved.');
        const text = textOf(message.content);
        if (message.role === 'tool') {
            const call = calls.get(message.tool_call_id);
            if (!call) throw new Error(`Tool result has no preceding call: ${message.tool_call_id}`);
            result.push({ role: 'tool', content: [], turnItems: [{ type: 'tool-result', toolResult: {
                toolCallId: call.id, toolName: call.name, result: message.nimiToolResult && Object.hasOwn(message.nimiToolResult, 'result') ? message.nimiToolResult.result : text,
                ...(message.nimiToolResult?.isError ? { isError: true } : {}),
            } }] });
            continue;
        }
        if (message.role === 'assistant') {
            if (Array.isArray(message.content) && message.content.some(part => part.type !== 'text')) throw new Error('Nimi does not admit media in assistant history. The attachment has been preserved.');
            const receipt = resolveNimiReceipt(message);
            const candidates = receipt?.segments || (receipt ? [receipt] : []);
            let turnItems = candidates.flatMap(segment => restoreTurnItems(segment.turnItems).filter(item => item.type === 'output' && (!segment.replayReset || item.output.type !== 'reasoning-continuity')));
            const canonicalText = turnItems.filter(item => item.output.type === 'text').map(item => item.output.text).join('');
            // A manual edit or ST prompt transformation establishes text context.
            // Source canonical receipts are retained; opaque bytes never acquire new text.
            if (!turnItems.length || (!message.tool_calls?.length && canonicalText !== text)) {
                if (receipt && canonicalText !== text) receipt.replayReset = true;
                turnItems = text ? [{ type: 'output', output: { type: 'text', text } }] : [];
                for (const call of message.tool_calls || []) turnItems.push({ type: 'output', output: { type: 'tool-call', toolCall: functionCall(call) } });
            }
            if (receipt?.replayReset) turnItems = turnItems.filter(item => item.output.type !== 'reasoning-continuity');
            for (const item of turnItems) if (item.output.type === 'tool-call') calls.set(item.output.toolCall.id, item.output.toolCall);
            if (turnItems.length) result.push({ role: 'assistant', content: [], turnItems });
            continue;
        }
        const content = [];
        if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'text') content.push({ type: 'text', text: part.text });
                else {
                    if (message.role !== 'user') throw new Error('Nimi admits media only in user messages.');
                    content.push(await uploadMedia(part));
                }
            }
        } else content.push({ type: 'text', text });
        result.push({ role: message.role, content });
    }
    return result;
}
export function toScenarioInput(request) {
    return {
        type: 'text-generate',
        messages: request.messages.map(message => message.turnItems?.length
            ? { role: 'assistant', text: '', turnItems: serializeNimi(message.turnItems) }
            : message.content.some(part => part.type !== 'text')
                ? { role: message.role, text: '', parts: message.content }
                : { role: message.role, text: message.content.map(part => part.text).join('') }),
        ...(request.tools?.length ? { tools: request.tools, toolChoice: request.toolChoice || 'auto' } : {}),
        ...(request.responseFormat ? { responseFormat: request.responseFormat } : {}),
        ...request.parameters,
    };
}
export function requireCompleteText(result) {
    if (!['stop', 'length', 'tool-calls'].includes(result.finishReason)) throw new Error(`Nimi did not complete this turn successfully (${result.finishReason}).`);
    const tools = result.outputItems?.filter(item => item.type === 'tool-call').map(item => item.toolCall) || [];
    if (!tools.length && !result.text?.trim()) throw Object.assign(new Error('Nimi returned no character response.'), { result });
    if (tools.length && result.finishReason === 'length') throw new Error('Nimi reached its output limit with unfinished tools; no callback was executed.');
    return result;
}
