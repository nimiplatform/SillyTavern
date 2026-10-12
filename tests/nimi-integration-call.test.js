import { jest } from '@jest/globals';
import { invokeIntegrationCall } from '../public/scripts/nimi/integration-call.js';

const pending = { callId: 'original-call', status: 'accepted', targetRef: 'service', operation: 'read' };
const request = { targetRef: 'service', operation: 'read', inputJson: '{}' };
function fixture(overrides = {}) {
    const controller = new AbortController();
    const work = { signal: controller.signal, guard: () => controller.signal.throwIfAborted(), end: jest.fn() };
    const integration = { invoke: jest.fn(async () => pending), getCall: jest.fn(async () => pending),
        cancelCall: jest.fn(async () => ({ ...pending, status: 'unconfirmed' })), ...overrides };
    const issued = jest.fn();
    const outcome = invokeIntegrationCall(integration, request, work, issued).catch(error => error);
    return { controller, work, integration, issued, outcome };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('deadline requests consumer cancellation and retains an unconfirmed external outcome', async () => {
    const f = fixture({ getCall: jest.fn(() => new Promise(() => {})) });
    await jest.advanceTimersByTimeAsync(120000);
    const error = await f.outcome;
    expect(f.integration.invoke).toHaveBeenCalledTimes(1);
    expect(f.integration.cancelCall).toHaveBeenCalledWith({ callId: pending.callId });
    expect(error.call.status).toBe('unconfirmed');
    expect(error.unconfirmed).toBe(true);
    expect(f.work.end).toHaveBeenCalledTimes(1);
});
test('stop during a pending read cancels without a provider supportsCancel gate', async () => {
    const f = fixture({ getCall: jest.fn(() => new Promise(() => {})), cancelCall: jest.fn(async () => ({ ...pending, status: 'canceled' })) });
    await jest.advanceTimersByTimeAsync(300);
    f.controller.abort(new DOMException('Chat changed', 'AbortError'));
    const error = await f.outcome;
    expect(f.integration.cancelCall).toHaveBeenCalledTimes(1);
    expect(error.call.status).toBe('canceled');
    expect(error.confirmedFailure).toBe(true);
    expect(error.unconfirmed).toBe(false);
});
test('an acceptance that arrives after stop is recorded and canceled without replay', async () => {
    let accept;
    const f = fixture({ invoke: jest.fn(() => new Promise(resolve => { accept = resolve; })),
        cancelCall: jest.fn(async () => ({ ...pending, status: 'canceled' })) });
    f.controller.abort(new DOMException('Stopped', 'AbortError'));
    expect((await f.outcome).unconfirmed).toBe(true);
    accept(pending);
    await jest.advanceTimersByTimeAsync(0);
    expect(f.integration.invoke).toHaveBeenCalledTimes(1);
    expect(f.integration.cancelCall).toHaveBeenCalledWith({ callId: pending.callId });
    expect(f.issued).toHaveBeenLastCalledWith({ ...pending, status: 'canceled' });
});
test('a completed effect observed during stop is retained without advancing the App turn', async () => {
    const complete = { ...pending, status: 'completed', resultJson: '{"text":"actual result"}' };
    const f = fixture({ cancelCall: jest.fn(async () => complete) });
    await jest.advanceTimersByTimeAsync(0);
    f.controller.abort(new DOMException('Stopped', 'AbortError'));
    const error = await f.outcome;
    expect(error.name).toBe('AbortError');
    expect(error.call).toEqual(complete);
    expect(error.integrationResult.result).toEqual({ text: 'actual result' });
    expect(f.integration.getCall).not.toHaveBeenCalled();
});
test('cancellation failure does not become a confirmed canceled effect', async () => {
    const failed = new Error('connection lost');
    const f = fixture({ cancelCall: jest.fn(async () => { throw failed; }) });
    await jest.advanceTimersByTimeAsync(0);
    f.controller.abort(new DOMException('Stopped', 'AbortError'));
    const error = await f.outcome;
    expect(error.call).toEqual(pending);
    expect(error.unconfirmed).toBe(true);
    expect(error.cancellationError).toBe(failed);
});
