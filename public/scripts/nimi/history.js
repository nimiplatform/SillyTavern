// Business receipts remain in each ST message/swipe, including original output.
let receiptResolver = () => null;
export function configureNimiReceiptResolver(resolver) { receiptResolver = resolver; }
export function resolveNimiReceipt(message) { return message.nimi || receiptResolver(message.nimiReceiptId); }
export function bindNimiReceipt(message, receipt) {
    if (receipt) Object.defineProperty(message, 'nimi', { value: receipt, writable: true, configurable: true });
}
export function serializeNimi(value) {
    return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? Array.from(item) : item));
}
export function nimiFailureDetails(error) {
    return serializeNimi({ message: error.message, reasonCode: error.reasonCode, traceId: error.traceId,
        jobId: error.jobId, details: error.details, interruption: error.interruption });
}
export function restoreTurnItems(items) {
    return (items || []).map(item => {
        if (item.type !== 'output' || item.output.type !== 'reasoning-continuity') return structuredClone(item);
        const payload = item.output.carrier.payload;
        if (!Array.isArray(payload) || payload.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Corrupt opaque continuity bytes.');
        return { ...item, output: { ...item.output, carrier: { ...item.output.carrier, payload: new Uint8Array(payload) } } };
    });
}
export function resultReceipt(result, resourceIdentity, scope) {
    const outputItems = result.outputItems || [];
    return { schema: 1, id: crypto.randomUUID(), status: 'completed', scope, resourceIdentity,
        result: serializeNimi(result), outputItems: serializeNimi(outputItems),
        turnItems: serializeNimi(outputItems.map(output => ({ type: 'output', output }))),
        createdAt: new Date().toISOString(), replayReset: false };
}
export function attachReceipt(message, receipt, { continuation = false, previousText, previousReceipt } = {}) {
    if (!receipt) return;
    const previous = previousReceipt || message.extra?.nimiPendingContinuation || message.extra?.nimi;
    const saved = serializeNimi(receipt);
    delete saved.scope;
    saved.displayText = message.mes;
    if (continuation && previous) {
        // ST joins prior text and the new continuation into one visible message.
        // The two actual model turns stay separate for future canonical replay.
        const segments = (previous.segments || [previous]).map(segment => previous.replayReset ? { ...segment, replayReset: true } : segment);
        const sourceText = segments.flatMap(segment => segment.outputItems || []).filter(item => item.type === 'text').map(item => item.text).join('');
        const prefix = previousText ?? previous.displayText;
        const prior = sourceText === prefix ? segments : [{ schema: 1, status: 'app-context', sourceReceipt: previous,
            turnItems: [{ type: 'output', output: { type: 'text', text: prefix } }], outputItems: [{ type: 'text', text: prefix }], replayReset: true }];
        saved.segments = [...prior, { ...saved, segments: undefined }];
    }
    message.extra ??= {};
    message.extra.nimi = saved;
    delete message.extra.nimiPendingContinuation;
    if (Array.isArray(message.swipe_info) && Number.isInteger(message.swipe_id)) {
        message.swipe_info[message.swipe_id] ??= { extra: {} };
        message.swipe_info[message.swipe_id].extra ??= {};
        message.swipe_info[message.swipe_id].extra.nimi = serializeNimi(saved);
        delete message.swipe_info[message.swipe_id].extra.nimiPendingContinuation;
    }
}
export function resetNimiReplay(messages) {
    for (const message of messages) {
        if (message.extra?.nimi) message.extra.nimi.replayReset = true;
        if (message.extra?.nimiPendingContinuation) message.extra.nimiPendingContinuation.replayReset = true;
        for (const info of message.swipe_info || []) if (info?.extra?.nimi) info.extra.nimi.replayReset = true;
    }
}
export function attachCandidateReceipts(message, candidates) {
    if (!Array.isArray(candidates) || candidates.length < 2) return;
    const start = message.swipes.length - candidates.length + 1;
    for (let index = 1; index < candidates.length; index++) {
        const swipe = start + index - 1;
        const receipt = serializeNimi(candidates[index]);
        delete receipt.scope;
        receipt.displayText = message.swipes[swipe];
        message.swipe_info[swipe].extra.nimi = receipt;
    }
}
