import { describe, expect, it } from 'vitest';
import { createScrcpyPointerIdTracker } from './scrcpyPointerIdTracker';

describe('scrcpyPointerIdTracker', () => {
  it('allocates stable ids for active source pointers', () => {
    const tracker = createScrcpyPointerIdTracker();

    expect(tracker.get(10)).toBeNull();
    expect(tracker.getOrCreate(10)).toBe(0n);
    expect(tracker.getOrCreate(10)).toBe(0n);
    expect(tracker.getOrCreate(11)).toBe(1n);
    expect(tracker.getNextPointerId()).toBe(2n);
  });

  it('releases individual pointers without rewinding the sequence', () => {
    const tracker = createScrcpyPointerIdTracker();

    expect(tracker.getOrCreate(10)).toBe(0n);
    tracker.release(10);

    expect(tracker.get(10)).toBeNull();
    expect(tracker.getOrCreate(10)).toBe(1n);
  });

  it('can clear active ids or reset the whole sequence', () => {
    const tracker = createScrcpyPointerIdTracker();

    tracker.getOrCreate(10);
    tracker.getOrCreate(11);
    tracker.clear();
    expect(tracker.get(10)).toBeNull();
    expect(tracker.getOrCreate(12)).toBe(2n);

    tracker.reset();
    expect(tracker.getOrCreate(13)).toBe(0n);
  });
});
