import { beginNimiOperation, getNimiClient, requireNimiCapability, planAppAiChatReplay, getNimiResourceIdentity } from './platform.bundle.js';
import { resultReceipt, serializeNimi, resolveNimiReceipt, nimiFailureDetails } from './history.js';
import { getRequestHeaders } from '../../script.js';
import { requireCompleteText, toNimiMessages, toScenarioInput, combineInitialSystemParagraphs } from './model-input.js';

async function uploadPart(part, operation) {
    operation.guard();
    let source;
    if (part.type === 'image_url') source = part.image_url?.url;
    else if (part.type === 'video_url') source = part.video_url?.url;
    else if (part.type === 'input_audio') {
        const audio = part.input_audio;
        source = `data:audio/${audio.format === 'mp3' ? 'mpeg' : audio.format};base64,${audio.data}`;
    } else if (part.type === 'artifact-ref') return part;
    else throw new Error(`Nimi cannot represent this media part: ${part.type}`);
    if (typeof source !== 'string') throw new Error('Missing media attachment.');
    // Local/data attachments enter the official owned artifact upload. Media is
    // never handed to a provider Files API, path or inline text-generation URL.
    const response = await fetch(source, { signal: operation.signal });
    if (!response.ok) throw new Error(`Cannot read the media attachment (${response.status}).`);
    const blob = await response.blob();
    const mimeType = blob.type.split(';')[0];
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/wav', 'audio/mpeg', 'video/mp4'].includes(mimeType)) throw new Error(`This media MIME is unavailable in Nimi text input: ${mimeType}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    operation.guard();
    const upload = await getNimiClient().ai.artifacts.upload({ bytes, mimeType });
    operation.guard();
    return { type: 'artifact-ref', artifactId: upload.artifactId, mediaType: upload.mimeType };
}
function commonResult(output, traceId) {
    const outputItems = output.items.map(item => item.type === 'reasoning-continuity'
        ? { ...item, carrier: { ...item.carrier, payload: new Uint8Array(item.carrier.payload) } } : item);
    return requireCompleteText({ text: outputItems.filter(item => item.type === 'text').map(item => item.text).join(''),
        finishReason: output.finishReason, outputItems,
        toolCalls: outputItems.filter(item => item.type === 'tool-call').map(item => item.toolCall), traceId });
}
function stCalls(result) {
    return (result.toolCalls || []).map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
}
function stResult(result, receipt) {
    return { choices: [{ index: 0, finish_reason: result.finishReason, message: { role: 'assistant', content: result.text, tool_calls: stCalls(result) } }], nimi: receipt };
}
async function executeCandidate(request, operation) {
    operation.guard();
    const response = await getNimiClient().ai.scenario.execute(toScenarioInput(request), { signal: operation.signal, timeoutMs: 120000 });
    operation.guard();
    if (response.output.type !== 'text-generate') throw new Error('Unexpected Nimi text result.');
    return commonResult(response.output, response.traceId);
}
async function retainTextFailure(error, operation) {
    // Keep correlation from the public SDK error even after its original chat
    // scope has gone away. This writes an App-owned result record only.
    try {
        await fetch('/api/nimi-media/save', { method: 'POST', headers: getRequestHeaders(), keepalive: true,
            body: JSON.stringify({ id: crypto.randomUUID(), artifacts: [], record: {
                purpose: 'text-failure', scenarioType: 'text-generate', scope: operation.scope,
                status: operation.signal.aborted ? 'interrupted' : 'failed', error: nimiFailureDetails(error),
            } }) });
    } catch (failure) { console.error('Could not retain the original text failure.', failure); }
}
export async function sendNimiText(type, data, signal) {
    const operation = beginNimiOperation(signal);
    try {
        const selection = await requireNimiCapability('text.generate');
        operation.guard();
        let messages = combineInitialSystemParagraphs(await toNimiMessages(data.messages, part => uploadPart(part, operation)));
        const history = messages.map(message => ({ ...message, content: message.content.length ? message.content : '' }));
        // Tools and structured results use the complete synchronous model step.
        // The UI can still consume a generator; no refused call is retried in another mode.
        const hasHistoryTools = data.messages.some(message => {
            const receipt = resolveNimiReceipt(message);
            return (receipt?.segments || (receipt ? [receipt] : [])).some(segment => segment.tools?.length);
        });
        const executionMode = data.stream && !data.tools?.length && !hasHistoryTools && !data.json_schema ? 'stream' : 'sync';
        const replay = planAppAiChatReplay({ history, selection, executionMode });
        if (replay.continuity === 'reset') for (const message of data.messages) {
            const receipt = resolveNimiReceipt(message);
            if (receipt) receipt.replayReset = true;
        }
        messages = replay.history.map((message, index) => ({ ...messages[index], ...(message.turnItems ? { turnItems: message.turnItems } : {}) }));
        const parameters = Object.fromEntries([
            ['temperature', data.temperature], ['topP', data.top_p], ['maxTokens', data.max_tokens],
            ['presencePenalty', data.presence_penalty], ['frequencyPenalty', data.frequency_penalty],
            ['topK', data.top_k], ['seed', data.seed],
        ].filter(([, value]) => value !== undefined));
        if (data.stop?.length) parameters.stop = data.stop;
        const request = { messages, parameters, signal: operation.signal,
            ...(data.tools?.length ? { tools: data.tools.map(tool => ({ type: 'function', name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })), toolChoice: data.tool_choice || 'auto' } : {}),
            ...(data.json_schema ? { responseFormat: { type: 'json-schema', name: data.json_schema.name, schema: data.json_schema.value,
                ...(data.json_schema.description ? { description: data.json_schema.description } : {}), ...(data.json_schema.strict !== undefined ? { strict: data.json_schema.strict } : {}) } } : {}) };
        const declarations = new Map((request.tools || []).map(tool => [tool.name, tool]));
        for (const message of data.messages) {
            const receipt = resolveNimiReceipt(message);
            for (const segment of receipt?.segments || (receipt ? [receipt] : [])) {
                for (const tool of segment.tools || []) if (!declarations.has(tool.name)) declarations.set(tool.name, tool);
            }
        }
        if (declarations.size) { request.tools = [...declarations.values()]; request.toolChoice ??= 'none'; }
        const identity = getNimiResourceIdentity(selection);
        const count = data.n || 1;
        if (!Number.isSafeInteger(count) || count < 1 || count > 10) throw new Error('Candidate count must be between 1 and 10.');
        if (!data.stream) {
            const results = [];
            const receipts = [];
            for (let index = 0; index < count; index++) {
                const result = await executeCandidate(request, operation);
                results.push(result);
                receipts.push({ ...resultReceipt(result, identity, operation.scope), tools: serializeNimi(request.tools || []) });
            }
            operation.end();
            return { ...stResult(results[0], receipts[0]), nimiCandidates: receipts,
                choices: results.map((result, index) => ({ index, finish_reason: result.finishReason,
                    message: { role: 'assistant', content: result.text, tool_calls: stCalls(result) } })) };
        }
        const localInput = toScenarioInput(request);
        delete localInput.type;
        const generator = async function* () {
            const candidates = [];
            const receipts = [];
            try {
                for (let candidate = 0; candidate < count; candidate++) {
                    operation.guard();
                    let result;
                    if (executionMode === 'sync') {
                        result = await executeCandidate(request, operation);
                    } else {
                        const items = new Map();
                        let text = '';
                        let done;
                        let traceId;
                        const stream = await getNimiClient().ai.text.streamTurn(localInput);
                        const abort = () => { void stream.cancel().catch(() => {}); };
                        operation.signal.addEventListener('abort', abort, { once: true });
                        try {
                            operation.guard();
                            for await (const event of stream) {
                                operation.guard();
                                traceId = event.traceId;
                                if (event.type === 'delta') {
                                    text += event.text;
                                    const previous = items.get(event.itemIndex);
                                    items.set(event.itemIndex, { type: 'text', text: (previous?.text || '') + event.text });
                                    yield { text: candidate === 0 ? text : candidates[0], swipes: candidate === 0 ? [] : [...candidates.slice(1), text],
                                        toolCalls: [], state: { reasoning: '', images: [], nimiScope: operation.scope } };
                                } else if (event.type === 'tool-call') items.set(event.itemIndex, { type: 'tool-call', toolCall: event.toolCall });
                                else if (event.type === 'reasoning-continuity') items.set(event.itemIndex, { type: 'reasoning-continuity', carrier: { ...event.carrier, payload: new Uint8Array(event.carrier.payload) } });
                                else if (event.type === 'completed') done = event;
                                else throw Object.assign(new Error(`Nimi text failed: ${event.reasonCode}`), { reasonCode: event.reasonCode, traceId: event.traceId, actionHint: event.actionHint, interruption: event.interruption });
                            }
                        } finally { operation.signal.removeEventListener('abort', abort); await stream.cancel(); }
                        operation.guard();
                        if (!done) throw new Error('Nimi stream ended without a successful terminal event.');
                        const outputItems = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
                        result = requireCompleteText({ text, outputItems, finishReason: done.finishReason, traceId,
                            toolCalls: outputItems.filter(item => item.type === 'tool-call').map(item => item.toolCall) });
                    }
                    candidates.push(result.text);
                    receipts.push({ ...resultReceipt(result, identity, operation.scope), tools: serializeNimi(request.tools || []) });
                }
                yield { text: candidates[0], swipes: candidates.slice(1), toolCalls: stCalls(receipts[0].result),
                    state: { reasoning: '', images: [], nimiScope: operation.scope, nimi: receipts[0], nimiCandidates: receipts } };
            } catch (error) { await retainTextFailure(error, operation); throw error; } finally { operation.end(); }
        };
        generator.nimiScope = operation.scope;
        return generator;
    } catch (error) {
        await retainTextFailure(error, operation);
        operation.end();
        // SDK errors retain trace/issued Job identity. Never automatically resubmit.
        console.error('Nimi text operation failed', { reasonCode: error.reasonCode, traceId: error.traceId, jobId: error.jobId });
        throw error;
    }
}
export function requireNimiToolTerminal(receipt) {
    if (!receipt || receipt.status !== 'completed') throw new Error('Tools require a completed Nimi model result.');
    requireCompleteText(receipt.result);
    return serializeNimi(receipt);
}
