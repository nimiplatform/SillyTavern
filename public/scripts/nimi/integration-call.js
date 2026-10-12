function waitWhileCurrent(promise, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', abort);
            callback(value);
        };
        const abort = () => finish(reject, signal.reason);
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

function resultValue(call) {
    return { callId: call.callId, targetRef: call.targetRef, operation: call.operation, result: JSON.parse(call.resultJson) };
}

// Runtime cancellation stops this consumer invocation. It does not promise to
// undo an external effect and is independent of the provider's supportsCancel.
export async function invokeIntegrationCall(integration, request, work, onIssued) {
    const deadline = new AbortController();
    const signal = AbortSignal.any([work.signal, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new Error('The original Integration call timed out; its outcome was not resubmitted.')), 120000);
    let call;
    let stopping = false;
    let cancellation;
    let cancellationError;
    const cancelPending = () => {
        if (cancellation) return cancellation;
        if (!call || call.status !== 'accepted') return Promise.resolve();
        cancellation = integration.cancelCall({ callId: call.callId }).then(observed => {
            // A late accepted poll must not replace an already observed terminal.
            if (call.status === 'accepted') call = observed;
        }).catch(error => { cancellationError = error; });
        return cancellation;
    };
    const abort = () => { void cancelPending(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        work.guard();
        // Keep observing the original acceptance even if the caller stops before
        // its ID arrives. That late ID is saved and canceled, never resubmitted.
        const issued = integration.invoke(request).then(async value => {
            call = value;
            try { await onIssued?.(call); } finally {
                if (stopping || signal.aborted) {
                    await cancelPending();
                    await onIssued?.(call);
                }
            }
            return value;
        });
        await waitWhileCurrent(issued, signal);
        work.guard();
        while (call.status === 'accepted') {
            await waitWhileCurrent(new Promise(resolve => setTimeout(resolve, 300)), signal);
            work.guard();
            const observed = await waitWhileCurrent(integration.getCall({ callId: call.callId }), signal);
            if (call.status === 'accepted') call = observed;
        }
        work.guard();
        if (call.status !== 'completed') throw new Error(`Integration ${call.status}: ${call.errorCode}`);
        if (!call.resultJson) throw new Error('The exact live scope has no confirmed Integration result.');
        return resultValue(call);
    } catch (error) {
        stopping = true;
        await cancelPending();
        error.call = call;
        error.unconfirmed = !call || ['accepted', 'unconfirmed'].includes(call.status) || (call.status === 'completed' && !call.resultJson);
        error.confirmedFailure = ['failed', 'canceled'].includes(call?.status);
        if (call?.status === 'completed' && call.resultJson) error.integrationResult = resultValue(call);
        if (cancellationError) error.cancellationError = cancellationError;
        throw error;
    } finally {
        stopping = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        work.end();
    }
}
