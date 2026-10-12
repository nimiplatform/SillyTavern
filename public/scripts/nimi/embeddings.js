import { beginNimiOperation, getNimiClient, requireNimiCapability, getNimiResourceIdentity, getNimiSnapshot } from './platform.bundle.js';

let currentSpace;
export function validateEmbeddingBatch(output, inputs) {
    if (output?.type !== 'text-embed' || !output.spaceId || output.vectors.length !== inputs.length) throw new Error('Nimi embedding batch identity or cardinality mismatch.');
    const dimension = output.vectors[0]?.length;
    if (!dimension || output.vectors.some(vector => vector.length !== dimension || vector.some(value => !Number.isFinite(value)))) throw new Error('Nimi embedding batch has invalid or mixed dimensions.');
    return { spaceId: output.spaceId, dimension, vectors: output.vectors };
}
// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-retrieval-purpose
export async function nimiVectorArguments(inputs, purpose = 'retrieval-document') {
    if (!['retrieval-document', 'retrieval-query'].includes(purpose)) throw new Error('Invalid embedding retrieval purpose.');
    const operation = beginNimiOperation();
    try {
        const selection = await requireNimiCapability('text.embed');
        operation.guard();
        const identity = getNimiResourceIdentity(selection) + getNimiSnapshot().revision;
        if (inputs.length === 0 && currentSpace?.identity === identity) {
            const result = { spaceId: currentSpace.spaceId, dimension: currentSpace.dimension };
            Object.defineProperty(result, 'operation', { value: operation });
            return result;
        }
        // List/delete require an actually Runtime-issued space before any model
        // output exists. This small embedding establishes that identity once.
        const texts = inputs.length ? inputs : ['SillyTavern retrieval index'];
        const response = await getNimiClient().ai.scenario.execute({ type: 'text-embed', inputs: texts, purpose }, { signal: operation.signal });
        operation.guard();
        const batch = validateEmbeddingBatch(response.output, texts);
        if (inputs.length && currentSpace?.identity === identity && currentSpace.spaceId !== batch.spaceId) {
            currentSpace = { identity, ...batch };
            throw new Error('Runtime embedding space changed during indexing. The old index is preserved; start a new indexing operation.', { cause: 'embedding_space_changed' });
        }
        currentSpace = { identity, spaceId: batch.spaceId, dimension: batch.dimension };
        const result = { spaceId: batch.spaceId, dimension: batch.dimension, ...(inputs.length ? { vectors: batch.vectors } : {}) };
        Object.defineProperty(result, 'operation', { value: operation });
        return result;
    } catch (error) { operation.end(); throw error; }
}
export async function nimiVectorFetch(url, init, args) {
    const operation = args.operation;
    try {
        operation.guard();
        const response = await fetch(url, { ...init, signal: operation.signal });
        await response.clone().text();
        operation.guard();
        return response;
    } finally { operation.end(); }
}
