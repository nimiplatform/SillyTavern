import { serializeNimi } from './history.js';

const UNKNOWN = new Set(['pending', 'running', 'unconfirmed']);
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
export function toolEffectFingerprint(name, parameters) {
    return JSON.stringify([name, canonical(typeof parameters === 'string' ? JSON.parse(parameters) : parameters)]);
}
export function createToolEffects(receipt, calls) {
    const actual = receipt.outputItems.filter(item => item.type === 'tool-call').map(item => item.toolCall);
    if (actual.length !== calls.length || actual.some((call, index) => call.id !== calls[index].id || call.name !== calls[index].function.name
        || toolEffectFingerprint(call.name, call.arguments) !== toolEffectFingerprint(calls[index].function.name, calls[index].function.arguments))) throw new Error('Tool callbacks do not match the completed canonical output.');
    return { id: receipt.id, effects: actual.map(call => ({ id: call.id, name: call.name, parameters: JSON.stringify(call.arguments), status: 'pending' })) };
}
export function assertToolEffectMayRun(effect, histories) {
    const fingerprint = toolEffectFingerprint(effect.name, effect.parameters);
    for (const history of histories) for (const prior of history.effects || []) {
        if (prior === effect) continue;
        if (UNKNOWN.has(prior.status) && toolEffectFingerprint(prior.name, prior.parameters) === fingerprint) throw new Error(`The prior outcome of ${effect.name} is unconfirmed. It was not retried. Review the original action first.`);
    }
}
export function effectInvocation(effect, displayName = effect.name) {
    const complete = effect.status === 'completed';
    const result = complete ? effect.result : effect.status === 'failed' ? effect.error
        : JSON.stringify({ status: effect.status, message: effect.status === 'not-executed' ? 'Canceled before this callback started.' : 'The callback outcome has not been confirmed; do not automatically repeat it.' });
    return { id: effect.id, name: effect.name, displayName, parameters: effect.parameters, result, error: !complete };
}
export function toolEffectsForStorage(plan) { return serializeNimi(plan); }
