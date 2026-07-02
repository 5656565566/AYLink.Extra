export interface PendingPointerControlPayload {
  payload: Uint8Array;
  onSent?: () => void;
}

interface ScrcpyControlChannelsOptions {
  controlBufferLimit: number;
  pointerMoveBufferLimit: number;
  isDroppableControlPayload: (payload: Uint8Array) => boolean;
  onControlChannelChanged: (channel: RTCDataChannel | null) => void;
  onMetaControlChannelChanged: (channel: RTCDataChannel | null) => void;
  onPointerMoveChannelChanged: (channel: RTCDataChannel | null) => void;
  onControlChannelOpen: () => void;
  onControlBufferedAmountLow: () => void;
  onPointerMoveChannelOpen: () => void;
  onPointerMoveBufferedAmountLow: () => void;
  onPersistConnection: () => void;
  logger?: Pick<Console, 'log' | 'warn'>;
}

export interface MetaControlSendOptions {
  requireDedicatedChannel?: boolean;
}

export function useScrcpyControlChannels(options: ScrcpyControlChannelsOptions) {
  const logger = options.logger ?? console;
  const pendingPointerControlPayloads: PendingPointerControlPayload[] = [];
  let controlChannel: RTCDataChannel | null = null;
  let metaControlChannel: RTCDataChannel | null = null;
  let pointerMoveChannel: RTCDataChannel | null = null;
  let pointerControlFlushHandle: number | null = null;

  const stopPointerControlFlushLoop = () => {
    if (pointerControlFlushHandle !== null) {
      window.cancelAnimationFrame(pointerControlFlushHandle);
      pointerControlFlushHandle = null;
    }
  };

  const schedulePointerControlFlush = () => {
    if (pointerControlFlushHandle !== null || pendingPointerControlPayloads.length === 0) {
      return;
    }

    pointerControlFlushHandle = window.requestAnimationFrame(() => {
      pointerControlFlushHandle = null;
      flushPendingPointerControlPayloads();
    });
  };

  const flushPendingPointerControlPayloads = () => {
    if (!controlChannel || controlChannel.readyState !== 'open') {
      return;
    }

    while (pendingPointerControlPayloads.length > 0) {
      if (controlChannel.bufferedAmount > options.controlBufferLimit) {
        schedulePointerControlFlush();
        return;
      }

      const pendingPayload = pendingPointerControlPayloads[0];
      try {
        controlChannel.send(pendingPayload.payload as unknown as ArrayBufferView<ArrayBuffer>);
        pendingPointerControlPayloads.shift();
        pendingPayload.onSent?.();
      } catch (error) {
        logger.warn('Pointer control send failed:', error);
        schedulePointerControlFlush();
        return;
      }
    }

    stopPointerControlFlushLoop();
  };

  const enqueuePointerControlPayloads = (...payloads: PendingPointerControlPayload[]) => {
    if (payloads.length === 0) {
      return true;
    }

    pendingPointerControlPayloads.push(...payloads);
    flushPendingPointerControlPayloads();
    if (pendingPointerControlPayloads.length > 0) {
      schedulePointerControlFlush();
    }
    return true;
  };

  const enqueuePointerPayloadBuffers = (payloads: Uint8Array[], onLastSent?: () => void) => {
    if (payloads.length === 0) {
      return false;
    }

    return enqueuePointerControlPayloads(
      ...payloads.map((payload, index) => ({
        payload,
        onSent: onLastSent && index === payloads.length - 1 ? onLastSent : undefined
      }))
    );
  };

  const getHighFrequencyControlChannel = () =>
    pointerMoveChannel?.readyState === 'open'
      ? pointerMoveChannel
      : controlChannel;

  const getPointerMoveSendChannel = () => {
    if (pointerMoveChannel?.readyState === 'open') {
      return pointerMoveChannel;
    }
    return controlChannel;
  };

  const markPointerMoveChannelUnhealthy = (channel: RTCDataChannel | null) => {
    if (!channel || pointerMoveChannel !== channel) {
      return;
    }

    pointerMoveChannel = null;
    options.onPointerMoveChannelChanged(null);
    options.onPersistConnection();
  };

  const sendBinaryControlMessage = (payload: Uint8Array, channel = controlChannel) => {
    if (!channel || channel.readyState !== 'open') {
      return;
    }
    if (channel.bufferedAmount > options.controlBufferLimit && options.isDroppableControlPayload(payload)) {
      return;
    }
    try {
      channel.send(payload as unknown as ArrayBufferView<ArrayBuffer>);
    } catch (error) {
      logger.warn('Binary control send failed:', error);
    }
  };

  const getMetaControlChannel = () => {
    if (metaControlChannel?.readyState === 'open') {
      return metaControlChannel;
    }
    return controlChannel;
  };

  const sendMetaControlMessage = (payload: Uint8Array, sendOptions?: MetaControlSendOptions) => {
    if (sendOptions?.requireDedicatedChannel) {
      sendBinaryControlMessage(payload, metaControlChannel);
      return;
    }
    sendBinaryControlMessage(payload, getMetaControlChannel());
  };

  const setupControlChannel = (channel: RTCDataChannel) => {
    controlChannel = channel;
    options.onControlChannelChanged(channel);
    channel.bufferedAmountLowThreshold = Math.floor(options.controlBufferLimit / 2);
    options.onPersistConnection();
    channel.onopen = () => {
      flushPendingPointerControlPayloads();
      options.onControlChannelOpen();
      options.onPersistConnection();
    };
    channel.onbufferedamountlow = () => {
      flushPendingPointerControlPayloads();
      options.onControlBufferedAmountLow();
    };
    channel.onclose = () => {
      if (controlChannel === channel) {
        controlChannel = null;
        options.onControlChannelChanged(null);
        options.onPersistConnection();
      }
    };
    channel.onmessage = (event) => logger.log('Data channel message:', event.data);
  };

  const setupMetaControlChannel = (channel: RTCDataChannel) => {
    metaControlChannel = channel;
    options.onMetaControlChannelChanged(channel);
    options.onPersistConnection();
    channel.onopen = () => {
      options.onPersistConnection();
    };
    channel.onclose = () => {
      if (metaControlChannel === channel) {
        metaControlChannel = null;
        options.onMetaControlChannelChanged(null);
        options.onPersistConnection();
      }
    };
  };

  const setupPointerMoveChannel = (channel: RTCDataChannel) => {
    pointerMoveChannel = channel;
    options.onPointerMoveChannelChanged(channel);
    channel.bufferedAmountLowThreshold = Math.floor(options.pointerMoveBufferLimit / 2);
    options.onPersistConnection();
    channel.onopen = () => {
      options.onPointerMoveChannelOpen();
      options.onPersistConnection();
    };
    channel.onbufferedamountlow = () => {
      options.onPointerMoveBufferedAmountLow();
    };
    channel.onclose = () => {
      if (pointerMoveChannel === channel) {
        pointerMoveChannel = null;
        options.onPointerMoveChannelChanged(null);
        options.onPersistConnection();
      }
    };
  };

  const clearPendingPointerControlPayloads = () => {
    pendingPointerControlPayloads.length = 0;
    stopPointerControlFlushLoop();
  };

  return {
    pendingPointerControlPayloads,
    getControlChannel: () => controlChannel,
    getMetaControlChannel,
    getPointerMoveChannel: () => pointerMoveChannel,
    getHighFrequencyControlChannel,
    getPointerMoveSendChannel,
    markPointerMoveChannelUnhealthy,
    setupControlChannel,
    setupMetaControlChannel,
    setupPointerMoveChannel,
    stopPointerControlFlushLoop,
    flushPendingPointerControlPayloads,
    enqueuePointerControlPayloads,
    enqueuePointerPayloadBuffers,
    sendBinaryControlMessage,
    sendMetaControlMessage,
    clearPendingPointerControlPayloads
  };
}
