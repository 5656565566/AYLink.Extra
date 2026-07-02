import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrcpyControlChannels } from './useScrcpyControlChannels';

class TestDataChannel {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onbufferedamountlow: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(payload: ArrayBufferView<ArrayBuffer>) {
    this.sent.push(payload as Uint8Array);
  }
}

function createHarness() {
  const onControlChannelChanged = vi.fn();
  const onMetaControlChannelChanged = vi.fn();
  const onPointerMoveChannelChanged = vi.fn();
  const onControlChannelOpen = vi.fn();
  const onControlBufferedAmountLow = vi.fn();
  const onPointerMoveChannelOpen = vi.fn();
  const onPointerMoveBufferedAmountLow = vi.fn();
  const onPersistConnection = vi.fn();
  const isDroppableControlPayload = vi.fn((payload: Uint8Array) => payload[0] === 9);
  const logger = {
    log: vi.fn(),
    warn: vi.fn()
  };

  const controlChannels = useScrcpyControlChannels({
    controlBufferLimit: 10,
    pointerMoveBufferLimit: 20,
    isDroppableControlPayload,
    onControlChannelChanged,
    onMetaControlChannelChanged,
    onPointerMoveChannelChanged,
    onControlChannelOpen,
    onControlBufferedAmountLow,
    onPointerMoveChannelOpen,
    onPointerMoveBufferedAmountLow,
    onPersistConnection,
    logger
  });

  return {
    controlChannels,
    onControlChannelChanged,
    onMetaControlChannelChanged,
    onPointerMoveChannelChanged,
    onControlChannelOpen,
    onControlBufferedAmountLow,
    onPointerMoveChannelOpen,
    onPointerMoveBufferedAmountLow,
    onPersistConnection,
    isDroppableControlPayload,
    logger
  };
}

describe('useScrcpyControlChannels', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues pointer control payloads until the control channel opens', () => {
    const harness = createHarness();
    const channel = new TestDataChannel();
    channel.readyState = 'connecting';
    const onSent = vi.fn();

    harness.controlChannels.setupControlChannel(channel as unknown as RTCDataChannel);
    harness.controlChannels.enqueuePointerControlPayloads({
      payload: new Uint8Array([1]),
      onSent
    });

    expect(channel.sent).toEqual([]);
    channel.readyState = 'open';
    channel.onopen?.();

    expect(channel.sent).toEqual([new Uint8Array([1])]);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(harness.onControlChannelOpen).toHaveBeenCalledTimes(1);
  });

  it('waits for bufferedamountlow before flushing queued control payloads', () => {
    const harness = createHarness();
    const channel = new TestDataChannel();
    channel.bufferedAmount = 11;

    harness.controlChannels.setupControlChannel(channel as unknown as RTCDataChannel);
    harness.controlChannels.enqueuePointerControlPayloads({ payload: new Uint8Array([1]) });

    expect(channel.sent).toEqual([]);
    channel.bufferedAmount = 0;
    channel.onbufferedamountlow?.();

    expect(channel.sent).toEqual([new Uint8Array([1])]);
    expect(harness.onControlBufferedAmountLow).toHaveBeenCalledTimes(1);
  });

  it('drops droppable direct sends when the control channel is over the buffer limit', () => {
    const harness = createHarness();
    const channel = new TestDataChannel();
    channel.bufferedAmount = 11;
    harness.controlChannels.setupControlChannel(channel as unknown as RTCDataChannel);

    harness.controlChannels.sendBinaryControlMessage(new Uint8Array([9]));
    harness.controlChannels.sendBinaryControlMessage(new Uint8Array([1]));

    expect(channel.sent).toEqual([new Uint8Array([1])]);
    expect(harness.isDroppableControlPayload).toHaveBeenCalledWith(new Uint8Array([9]));
  });

  it('prefers the pointer move channel for high frequency control when it is open', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    const pointerMoveChannel = new TestDataChannel();

    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupPointerMoveChannel(pointerMoveChannel as unknown as RTCDataChannel);

    expect(harness.controlChannels.getHighFrequencyControlChannel()).toBe(pointerMoveChannel);
    expect(pointerMoveChannel.bufferedAmountLowThreshold).toBe(10);

    pointerMoveChannel.onopen?.();
    expect(harness.onPointerMoveChannelOpen).toHaveBeenCalledTimes(1);
  });

  it('falls back to the reliable control channel while pointer move channel is connecting', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    const pointerMoveChannel = new TestDataChannel();
    pointerMoveChannel.readyState = 'connecting';

    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupPointerMoveChannel(pointerMoveChannel as unknown as RTCDataChannel);

    expect(harness.controlChannels.getHighFrequencyControlChannel()).toBe(controlChannel);
    expect(harness.controlChannels.getPointerMoveSendChannel()).toBe(controlChannel);
  });

  it('clears an unhealthy pointer move channel so moves can fall back to control', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    const pointerMoveChannel = new TestDataChannel();

    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupPointerMoveChannel(pointerMoveChannel as unknown as RTCDataChannel);

    harness.controlChannels.markPointerMoveChannelUnhealthy(pointerMoveChannel as unknown as RTCDataChannel);

    expect(harness.controlChannels.getPointerMoveChannel()).toBeNull();
    expect(harness.controlChannels.getPointerMoveSendChannel()).toBe(controlChannel);
    expect(harness.onPointerMoveChannelChanged).toHaveBeenLastCalledWith(null);
    expect(harness.onPersistConnection).toHaveBeenCalled();
  });

  it('falls back to the control channel when meta or pointer channels are unavailable', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    const metaChannel = new TestDataChannel();
    metaChannel.readyState = 'closed';

    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupMetaControlChannel(metaChannel as unknown as RTCDataChannel);

    expect(harness.controlChannels.getMetaControlChannel()).toBe(controlChannel);
    expect(harness.controlChannels.getHighFrequencyControlChannel()).toBe(controlChannel);
  });

  it('does not fall back to the control channel when a dedicated meta send is required', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);

    harness.controlChannels.sendMetaControlMessage(new Uint8Array([0xff, 0x02]), {
      requireDedicatedChannel: true
    });

    expect(controlChannel.sent).toEqual([]);
  });

  it('clears channel references on close', () => {
    const harness = createHarness();
    const controlChannel = new TestDataChannel();
    const metaChannel = new TestDataChannel();
    const pointerMoveChannel = new TestDataChannel();

    harness.controlChannels.setupControlChannel(controlChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupMetaControlChannel(metaChannel as unknown as RTCDataChannel);
    harness.controlChannels.setupPointerMoveChannel(pointerMoveChannel as unknown as RTCDataChannel);
    controlChannel.onclose?.();
    metaChannel.onclose?.();
    pointerMoveChannel.onclose?.();

    expect(harness.controlChannels.getControlChannel()).toBeNull();
    expect(harness.controlChannels.getMetaControlChannel()).toBeNull();
    expect(harness.controlChannels.getPointerMoveChannel()).toBeNull();
    expect(harness.onControlChannelChanged).toHaveBeenLastCalledWith(null);
    expect(harness.onMetaControlChannelChanged).toHaveBeenLastCalledWith(null);
    expect(harness.onPointerMoveChannelChanged).toHaveBeenLastCalledWith(null);
  });
});
