import { describe, expect, it } from 'vitest';
import { createLatestRequestController } from './latestRequest';

describe('latestRequest', () => {
  it('aborts the previous request when a new request starts', () => {
    const controller = createLatestRequestController();

    const first = controller.begin();
    const second = controller.begin();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(controller.isLatest(first.requestId)).toBe(false);
    expect(controller.isLatest(second.requestId)).toBe(true);
  });

  it('does not clear the latest controller when an old request finishes', () => {
    const controller = createLatestRequestController();

    const first = controller.begin();
    const second = controller.begin();

    controller.finalize(first.requestId);
    controller.cancel();

    expect(second.signal.aborted).toBe(true);
  });
});
