import { getRequestHeaders } from '../../script.js';
import { beginNimiOperation, getNimiClient, requireNimiCapability, getNimiResourceIdentity, observeNimiMediaJob } from './platform.bundle.js';
import { serializeNimi } from './history.js';
import { sendNimiText } from './text.js';

const contracts = { 'image-generate': 'image.generate', 'speech-synthesize': 'audio.synthesize', 'speech-transcribe': 'audio.transcribe', 'voice-create': 'voice.create' };
const jobMetadata = job => ({ ...job, artifacts: job.artifacts.map(({ bytes: _bytes, ...artifact }) => artifact) });
function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
}
async function saveRecord(id, record, artifacts = [], signal) {
    const response = await fetch('/api/nimi-media/save', { method: 'POST', headers: getRequestHeaders(), signal,
        body: JSON.stringify({ id, record: serializeNimi(record), artifacts: artifacts.map(artifact => {
            const { bytes, ...metadata } = artifact; return { ...metadata, base64: base64(bytes) };
        }) }) });
    if (!response.ok) throw new Error((await response.json()).error || 'Could not save the complete Nimi media result.');
    return response.json();
}
async function observeJob(job, operation) {
    operation.guard();
    const response = await observeNimiMediaJob(job, operation.signal);
    operation.guard();
    return response;
}
async function finishJob(id, response, operation, previousError) {
    const job = response.job;
    operation.guard();
    if (job.status !== 'completed') {
        await saveRecord(id, { status: job.status, job: jobMetadata(job) }, [], operation.signal);
        throw Object.assign(new Error(`Nimi Job ${job.status}: ${job.reasonDetail || job.reasonCode}`), { jobId: job.jobId, reasonCode: job.reasonCode, traceId: job.traceId });
    }
    const artifacts = [];
    for (const artifact of job.artifacts) {
        let bytes = artifact.bytes;
        if (!bytes?.length) bytes = (await getNimiClient().ai.artifacts.read(artifact.artifactId)).bytes;
        operation.guard();
        if (!bytes?.length || bytes.length !== artifact.sizeBytes) throw new Error(`Incomplete Nimi artifact: ${artifact.artifactId}`);
        artifacts.push({ ...artifact, bytes });
    }
    const record = await saveRecord(id, { status: 'completed', job: jobMetadata(job),
        result: { ...response, job: jobMetadata(job) }, error: null,
        ...(previousError ? { recoveredError: previousError } : {}) }, artifacts, operation.signal);
    operation.guard();
    return record;
}
export async function runNimiMediaJob(spec, { signal, onSubmitted, inputAssets = [] } = {}) {
    const operation = beginNimiOperation(signal);
    const id = crypto.randomUUID();
    const clientSubmissionId = spec.type === 'music-generate' ? crypto.randomUUID() : undefined;
    let job;
    try {
        const selection = await requireNimiCapability(contracts[spec.type]);
        operation.guard();
        let input = spec;
        const inputs = [...inputAssets];
        if (spec.type === 'speech-transcribe' && spec.audioSource.type === 'bytes') {
            const bytes = spec.audioSource.bytes;
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const sha256 = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
            inputs.push({ role: 'input', mimeType: spec.mimeType, sizeBytes: bytes.length, sha256, bytes });
            input = { ...spec, audioSource: { type: 'app-owned-asset', sha256, sizeBytes: bytes.length, mimeType: spec.mimeType } };
        }
        operation.guard();
        await saveRecord(id, { status: 'submitting', clientSubmissionId, scenarioType: spec.type, resourceIdentity: getNimiResourceIdentity(selection), input }, inputs, operation.signal);
        operation.guard();
        const submitted = await getNimiClient().ai.scenarioJobs.submit(spec, clientSubmissionId ? { clientSubmissionId } : undefined);
        job = submitted.job;
        if (operation.signal.aborted) {
            await getNimiClient().ai.scenarioJobs.cancel(job.jobId, 'sillytavern-canceled-during-submission');
            operation.guard();
        }
        await saveRecord(id, { status: job.status, job: jobMetadata(job) }, [], operation.signal);
        operation.guard();
        onSubmitted?.(job);
        const response = await observeJob(job, operation);
        job = response.job;
        return await finishJob(id, response, operation);
    } catch (error) {
        if (job && operation.signal.aborted && !['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) {
            await getNimiClient().ai.scenarioJobs.cancel(job.jobId, 'sillytavern-user-canceled').catch(() => {});
        }
        // Persist the original submission identity and issued Job; recovery is
        // an explicit observation action, never automatic business resubmission.
        await saveRecord(id, { status: operation.signal.aborted ? 'interrupted' : job?.status === 'completed' ? 'save-failed' : 'failed',
            ...(job ? { job: jobMetadata(job) } : {}),
            ...(error.jobId ? { issuedJobId: error.jobId } : {}),
            error: { message: error.message, reasonCode: error.reasonCode, traceId: error.traceId, jobId: error.jobId, details: error.details, interruption: error.interruption } }).catch(() => {});
        throw error;
    } finally { operation.end(); }
}
export async function recoverNimiMediaRecord(record) {
    const operation = beginNimiOperation();
    try {
        const jobId = record.job?.jobId || record.issuedJobId;
        if (!jobId && !record.clientSubmissionId) throw new Error('No issued Job identity is available for this attempt. Its outcome cannot be recovered or automatically resubmitted.');
        const response = jobId ? await getNimiClient().ai.scenarioJobs.get(jobId)
            : await getNimiClient().ai.scenarioJobs.lookupSubmission(record.clientSubmissionId);
        operation.guard();
        return await finishJob(record.id, await observeJob(response.job, operation), operation, record.error);
    } finally { operation.end(); }
}
export async function generateNimiImage(prompt, negativePrompt, settings, signal, referenceUrl = null) {
    const operation = beginNimiOperation(signal);
    try {
        let referenceImageArtifactId = '';
        const inputAssets = [];
        if (referenceUrl) {
            const response = await fetch(referenceUrl, { signal: operation.signal });
            if (!response.ok) throw new Error('The saved reference image could not be read.');
            const blob = await response.blob();
            operation.guard();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const mimeType = blob.type.split(';')[0];
            const upload = await getNimiClient().ai.artifacts.upload({ bytes, mimeType });
            operation.guard();
            referenceImageArtifactId = upload.artifactId;
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const sha256 = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
            inputAssets.push({ role: 'input', artifactId: upload.artifactId, bytes, mimeType, sizeBytes: bytes.length, sha256 });
        }
        const overrides = settings.nimi_image_overrides || {};
        return await runNimiMediaJob({ type: 'image-generate', prompt, negativePrompt: overrides.negative !== false ? negativePrompt : '',
            size: overrides.size !== false ? `${settings.width}x${settings.height}` : '',
            aspectRatio: settings.nimi_aspect_ratio || '', quality: '', style: '', referenceImages: [], referenceImageArtifactId, mask: '', responseFormat: '',
            ...(overrides.seed !== false && settings.seed >= 0 ? { seed: Number(settings.seed) } : {}),
            ...(overrides.strength !== false && referenceUrl && Number.isFinite(settings.strength) ? { strength: settings.strength } : {}) }, { signal: operation.signal, inputAssets });
    } finally { operation.end(); }
}
export async function synthesizeNimiSpeech(text, voiceId, settings, signal) {
    const voiceRef = voiceId?.startsWith('asset:') ? { type: 'voice-asset', id: voiceId.slice(6) }
        : voiceId?.startsWith('preset:') ? { type: 'preset', id: voiceId.slice(7) } : null;
    return runNimiMediaJob({ type: 'speech-synthesize', text, language: settings.language || '', audioFormat: settings.audioFormat || 'mp3',
        ...(settings.speed !== undefined && Number(settings.speed) !== 1 ? { speed: Number(settings.speed) } : {}), emotion: '', voiceRef,
        timingMode: 'none', voiceRenderHints: null }, { signal });
}
export async function transcribeNimiAudio(blob, { language = '', timestamps = false, signal } = {}) {
    return runNimiMediaJob({ type: 'speech-transcribe', mimeType: blob.type, language, timestamps,
        prompt: '', responseFormat: '', audioSource: { type: 'bytes', bytes: new Uint8Array(await blob.arrayBuffer()) } }, { signal });
}
export async function captionNimiMedia(fileData, prompt) {
    const operation = beginNimiOperation();
    try {
        const type = fileData.startsWith('data:video/') ? 'video_url' : fileData.startsWith('data:audio/') ? 'input_audio' : 'image_url';
        const part = type === 'input_audio'
            ? { type, input_audio: { data: fileData.split(',')[1], format: fileData.startsWith('data:audio/mpeg') ? 'mp3' : 'wav' } }
            : { type, [type]: { url: fileData } };
        const data = await sendNimiText('quiet', { stream: false, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, part] }] }, operation.signal);
        operation.guard();
        if (data.nimi.result.finishReason !== 'stop') throw new Error('Nimi did not finish the media description.');
        const response = await fetch(fileData, { signal: operation.signal });
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        operation.guard();
        const record = await saveRecord(crypto.randomUUID(), { status: 'completed', scenarioType: 'text-generate', purpose: 'media-description',
            caption: data.nimi.result.text, prompt, nimi: data.nimi }, [{ role: 'input', mimeType: blob.type.split(';')[0], sizeBytes: bytes.length, bytes }], operation.signal);
        operation.guard();
        return { caption: data.nimi.result.text, nimi: data.nimi, nimiMedia: record };
    } finally { operation.end(); }
}
export async function decideNimiExpression(text, labels, instructions) {
    const operation = beginNimiOperation();
    try {
        await requireNimiCapability('text.decide'); operation.guard();
        const response = await getNimiClient().ai.scenario.execute({ type: 'text-decide', state: { text },
            questions: [{ id: 'expression', kind: 'choice', instructions: { text: instructions || 'Choose the expression that best fits this character speech.' }, candidates: labels.map(id => ({ id })) }] }, { signal: operation.signal });
        operation.guard();
        const answer = response.output.answers[0];
        if (answer.kind !== 'choice') throw new Error('Unexpected expression decision.');
        return { answer, result: serializeNimi(response) };
    } finally { operation.end(); }
}
