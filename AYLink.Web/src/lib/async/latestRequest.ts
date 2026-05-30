export interface LatestRequestHandle {
  requestId: number;
  signal: AbortSignal;
}

export function createLatestRequestController() {
  let currentRequestId = 0;
  let currentController: AbortController | null = null;

  function begin(): LatestRequestHandle {
    currentRequestId += 1;
    currentController?.abort();
    currentController = new AbortController();

    return {
      requestId: currentRequestId,
      signal: currentController.signal,
    };
  }

  function isLatest(requestId: number) {
    return requestId === currentRequestId;
  }

  function finalize(requestId: number) {
    if (requestId === currentRequestId) {
      currentController = null;
    }
  }

  function cancel() {
    currentController?.abort();
    currentController = null;
  }

  return {
    begin,
    isLatest,
    finalize,
    cancel,
    dispose: cancel,
  };
}
