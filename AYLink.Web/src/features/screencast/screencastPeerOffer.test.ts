import { describe, expect, it, vi } from 'vitest';
import { createScreencastPeerOfferSession } from './screencastPeerOffer';

describe('createScreencastPeerOfferSession', () => {
  it('creates receive-only media transceivers, control channels, and a local offer', async () => {
    const localDescription = { type: 'offer', sdp: 'local-sdp' } as RTCSessionDescription;
    const offer = { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit;
    const channels = new Map<string, RTCDataChannel>();
    const peerConnection = {
      localDescription,
      addTransceiver: vi.fn(),
      createDataChannel: vi.fn((label: string) => {
        const channel = { label } as RTCDataChannel;
        channels.set(label, channel);
        return channel;
      }),
      createOffer: vi.fn(async () => offer),
      setLocalDescription: vi.fn(async () => undefined)
    } as unknown as RTCPeerConnection;
    const createPeerConnection = vi.fn(() => peerConnection);
    const configuration = { iceTransportPolicy: 'all' } satisfies RTCConfiguration;

    const session = await createScreencastPeerOfferSession(configuration, { createPeerConnection });

    expect(createPeerConnection).toHaveBeenCalledWith(configuration);
    expect(peerConnection.addTransceiver).toHaveBeenCalledWith('video', { direction: 'recvonly' });
    expect(peerConnection.addTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' });
    expect(peerConnection.createDataChannel).toHaveBeenCalledWith('control');
    expect(peerConnection.createDataChannel).toHaveBeenCalledWith('control-meta');
    expect(peerConnection.createDataChannel).toHaveBeenCalledWith('pointer-move', { ordered: false, maxRetransmits: 0 });
    expect(peerConnection.createOffer).toHaveBeenCalled();
    expect(peerConnection.setLocalDescription).toHaveBeenCalledWith(offer);
    expect(session.peerConnection).toBe(peerConnection);
    expect(session.channels.controlChannel).toBe(channels.get('control'));
    expect(session.channels.metaControlChannel).toBe(channels.get('control-meta'));
    expect(session.channels.pointerMoveChannel).toBe(channels.get('pointer-move'));
    expect(session.localDescription).toBe(localDescription);
  });

  it('runs the preparation hook before setting the local description', async () => {
    const localDescription = { type: 'offer', sdp: 'local-sdp' } as RTCSessionDescription;
    const offer = { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit;
    const calls: string[] = [];
    const peerConnection = {
      localDescription,
      addTransceiver: vi.fn(),
      createDataChannel: vi.fn((label: string) => ({ label }) as RTCDataChannel),
      createOffer: vi.fn(async () => {
        calls.push('createOffer');
        return offer;
      }),
      setLocalDescription: vi.fn(async () => {
        calls.push('setLocalDescription');
      })
    } as unknown as RTCPeerConnection;

    await createScreencastPeerOfferSession({}, {
      createPeerConnection: () => peerConnection,
      beforeSetLocalDescription: ({ peerConnection: preparedPeerConnection, channels }) => {
        calls.push('beforeSetLocalDescription');
        expect(preparedPeerConnection).toBe(peerConnection);
        expect(channels.controlChannel.label).toBe('control');
        expect(channels.metaControlChannel.label).toBe('control-meta');
        expect(channels.pointerMoveChannel.label).toBe('pointer-move');
      }
    });

    expect(calls).toEqual(['createOffer', 'beforeSetLocalDescription', 'setLocalDescription']);
  });
});
