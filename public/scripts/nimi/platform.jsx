import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import { createNimiLocalAppRuntimeScenarioJobClient } from '@nimiplatform/sdk/app';
import { observeNimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { ModelConfigAIConfigSurface } from '@nimiplatform/kit/features/model-config';
import { planAppAiChatReplay } from '@nimiplatform/kit/features/chat/runtime';

const APP_ID = 'org.nimiplatform.sillytavern';
export const CAPABILITIES = ['text.generate', 'text.embed', 'image.generate', 'audio.synthesize', 'audio.transcribe', 'text.decide'];
let client;
let snapshot = null;
let configRefresh;
let scopeReader = () => '';
let epoch = 0;
const operations = new Set();
const listeners = new Set();

// The generated reference's formal client construction; no endpoint or credential.
export function getNimiClient() {
    client ??= createNimiClient({ localApp: { standardShell: createNimiLocalAppStandardShellSurface() } });
    return client;
}
export { createNimiLocalAppTextModel, planAppAiChatReplay };
export async function observeNimiMediaJob(job, signal) {
    const scenarioType = {
        'image-generate': ScenarioType.IMAGE_GENERATE,
        'speech-synthesize': ScenarioType.SPEECH_SYNTHESIZE,
        'speech-transcribe': ScenarioType.SPEECH_TRANSCRIBE,
        'voice-create': ScenarioType.VOICE_CREATE,
    }[job.scenarioType];
    if (scenarioType === undefined) throw new Error('Unsupported SillyTavern media Job.');
    await observeNimiRuntimeScenarioJob({
        ai: createNimiLocalAppRuntimeScenarioJobClient(getNimiClient().ai),
        jobId: job.jobId,
        scenarioType,
        signal,
        cancelSignal: signal,
        abortReason: 'sillytavern-user-canceled',
    });
    // Retain the complete Local App Get projection for durable media records,
    // including result fields that are not part of the Job snapshot.
    return getNimiClient().ai.scenarioJobs.get(job.jobId);
}
export function configureScopeReader(reader) { scopeReader = reader; }
export function cancelNimiWork(reason = 'SillyTavern work stopped') {
    epoch++;
    for (const operation of operations) operation.abort(new DOMException(reason, 'AbortError'));
    operations.clear();
    window.dispatchEvent(new CustomEvent('nimi-work-invalidated', { detail: reason }));
}
export function captureNimiScope() { return { epoch, key: scopeReader() }; }
export function assertNimiScope(scope) {
    if (!scope || scope.epoch !== epoch || scope.key !== scopeReader()) throw new DOMException('This SillyTavern operation is no longer current.', 'AbortError');
}
export function beginNimiOperation(signal) {
    const controller = new AbortController();
    const scope = captureNimiScope();
    operations.add(controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    return { scope, signal: combined,
        guard() { combined.throwIfAborted(); assertNimiScope(scope); },
        end() { operations.delete(controller); } };
}
export function getNimiSnapshot() { return snapshot; }
export function getNimiSelection(contract = 'text.generate') { return snapshot?.effectiveSelections?.find(item => item.capabilityContract === contract); }
export function getNimiModelLabel() {
    const selection = getNimiSelection();
    const resource = selection?.resource;
    return resource?.oneofKind === 'cloud' ? resource.cloud.target.label : resource?.oneofKind === 'local' ? resource.local.label : 'Nimi';
}
export function getNimiResourceIdentity(selection = getNimiSelection()) {
    const resource = selection?.resource;
    if (!resource) return '';
    return resource.oneofKind === 'local' ? JSON.stringify(['local', resource.local.loadoutRef, resource.local.implementation])
        : JSON.stringify(['cloud', resource.cloud.connector.connectorRef, resource.cloud.target.implementation, resource.cloud.target.providerModelTarget]);
}
export function nimiSupports(feature, contract = 'text.generate') {
    const resource = getNimiSelection(contract)?.resource;
    const features = resource?.oneofKind === 'local' ? resource.local.configuredFeatures : resource?.oneofKind === 'cloud' ? resource.cloud.target.supportedFeatures : [];
    return features?.includes(feature) ?? false;
}
async function readNimiConfig() {
    const auth = await getNimiClient().auth.status();
    if (!auth.sessionBound) {
        snapshot = null;
        cancelNimiWork(auth.reasonCode);
        throw Object.assign(new Error(`Nimi access unavailable: ${auth.reasonCode}`), { reasonCode: auth.reasonCode, actionHint: auth.actionHint });
    }
    const previousIdentity = getNimiResourceIdentity();
    const next = await getNimiClient().aiConfig.get();
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return snapshot;
    snapshot = next;
    if (previousIdentity && getNimiResourceIdentity() && previousIdentity !== getNimiResourceIdentity()) {
        cancelNimiWork('Text resource changed');
        window.dispatchEvent(new Event('nimi-model-context-change'));
    }
    for (const listener of listeners) listener(snapshot);
    return snapshot;
}
export function refreshNimiConfig() {
    configRefresh ??= readNimiConfig().finally(() => { configRefresh = undefined; });
    return configRefresh;
}
export async function requireNimiCapability(contract) {
    await refreshNimiConfig();
    const selection = getNimiSelection(contract);
    if (selection?.state !== 'ready') throw new Error(`${contract}: ${selection?.reasons?.join(', ') || 'Configure this capability in Nimi AI settings.'}`);
    return selection;
}
export function mountNimiConfiguration(element, onChanged) {
    const root = createRoot(element);
    function Configuration() {
        const [state, setState] = useState(snapshot);
        const [error, setError] = useState(null);
        const [loading, setLoading] = useState(true);
        async function refresh() {
            setLoading(true);
            try { setState(await refreshNimiConfig()); setError(null); }
            catch (failure) { setError(failure.message); setState(undefined); }
            finally { setLoading(false); }
        }
        useEffect(() => { void refresh(); const listener = value => setState(value); listeners.add(listener); return () => listeners.delete(listener); }, []);
        return <ModelConfigAIConfigSurface context={{ owner: 'app-ai-config', appId: APP_ID }}
            capabilityContracts={CAPABILITIES} capabilities={state?.config?.capabilities ?? (state === undefined ? undefined : null)}
            revision={state?.revision} effectiveSelections={state?.effectiveSelections}
            loading={loading} loadError={error} onRetry={refresh}
            listOptions={query => getNimiClient().aiConfig.listOptions(query)}
            onOverwrite={async input => {
                const before = getNimiResourceIdentity();
                const result = await getNimiClient().aiConfig.overwrite(input);
                await refresh();
                if (result.outcome === 'committed') { cancelNimiWork('AI configuration changed'); onChanged?.(before !== getNimiResourceIdentity()); }
                return result;
            }} language={document.documentElement.lang || 'en'} />;
    }
    // Kit dialogs render through portals. React's event path still reaches
    // this wrapper, so ST's outside-drawer handler must not close their editor.
    root.render(<div onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}><Configuration /></div>);
    return () => root.unmount();
}
window.addEventListener('pagehide', () => cancelNimiWork('Window closed or refreshed'));
