export interface ScreencastPeerOfferChannels {
  controlChannel: RTCDataChannel;
  metaControlChannel: RTCDataChannel;
  pointerMoveChannel: RTCDataChannel;
}

export interface ScreencastPeerOfferSession {
  peerConnection: RTCPeerConnection;
  channels: ScreencastPeerOfferChannels;
  localDescription: RTCSessionDescription | null;
}

export interface CreateScreencastPeerOfferOptions {
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
}

export async function createScreencastPeerOfferSession(
  rtcConfiguration: RTCConfiguration,
  options: CreateScreencastPeerOfferOptions = {}
): Promise<ScreencastPeerOfferSession> {
  const createPeerConnection = options.createPeerConnection ?? ((configuration: RTCConfiguration) => new RTCPeerConnection(configuration));
  const peerConnection = createPeerConnection(rtcConfiguration);

  peerConnection.addTransceiver('video', { direction: 'recvonly' });
  peerConnection.addTransceiver('audio', { direction: 'recvonly' });
  const controlChannel = peerConnection.createDataChannel('control');
  const metaControlChannel = peerConnection.createDataChannel('control-meta');
  const pointerMoveChannel = peerConnection.createDataChannel('pointer-move', { ordered: false, maxRetransmits: 0 });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  return {
    peerConnection,
    channels: {
      controlChannel,
      metaControlChannel,
      pointerMoveChannel
    },
    localDescription: peerConnection.localDescription
  };
}
