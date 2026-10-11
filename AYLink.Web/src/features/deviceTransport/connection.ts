import { apiFetch } from '../../utils/api';
import { isAbortError } from '../../lib/async/abort';
import { useAuth } from '../../services/auth';
import { loadLocalWebRtcOverrideConfig, loadLocalWebRtcOverrideEnabled, toRtcConfiguration, type WebRtcNetworkSettingsPayload } from '../../services/webrtcSettings';
import { requestOnChannel, waitWithSignal, type UploadProgress } from './channel';

const CONNECT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 60_000;
// 缓存当前账号对同一设备的建连失败结果 避免上传文件夹时逐个文件重复等待 ICE 建连
// 缓存到期后 新操作可再次尝试建连
const UNAVAILABLE_CACHE_MS = 30_000;

export interface DeviceConnection {
  readonly isOpen: boolean;
  request(url: string, init: RequestInit, onProgress?: (progress: UploadProgress) => void): Promise<Response>;
  close(): void;
}

class PeerDeviceConnection implements DeviceConnection {
  private active = 0;
  private nextRequest = 1;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Set<RTCDataChannel>();
  private readonly peer: RTCPeerConnection;
  constructor(peer: RTCPeerConnection) { this.peer = peer; this.resetIdle(); }
  get isOpen() { return this.peer.connectionState === 'connected'; }
  private resetIdle() {
    clearTimeout(this.idle);
    if (this.active === 0 && this.isOpen) this.idle = setTimeout(() => this.close(), IDLE_TIMEOUT_MS);
  }
  request(url: string, init: RequestInit, onProgress?: (progress: UploadProgress) => void) {
    if (!this.isOpen) return Promise.reject(new Error('WebRTC connection closed before request'));
    const channel = this.peer.createDataChannel(`request-${this.nextRequest++}`);
    this.pending.add(channel);
    this.active++;
    clearTimeout(this.idle);
    return requestOnChannel(channel, url, init, onProgress, () => {
      this.pending.delete(channel);
      this.active--;
      this.resetIdle();
    });
  }
  close() {
    clearTimeout(this.idle);
    for (const channel of this.pending) channel.close();
    this.peer.close();
  }
}

async function connectDevice(deviceID: string): Promise<DeviceConnection> {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC is unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  let peer: RTCPeerConnection | undefined;
  try {
    const endpoint = `/api/devices/${encodeURIComponent(deviceID)}/transport`;
    const configuration = await apiFetch(endpoint, { signal: controller.signal, handleForbidden: false });
    if (!configuration.ok) throw new Error(`WebRTC negotiation unavailable (${configuration.status})`);
    const settings = await configuration.json() as WebRtcNetworkSettingsPayload;
    const scope = String(useAuth().currentUser.value?.Id ?? 'anonymous');
    const local = loadLocalWebRtcOverrideEnabled(scope) ? loadLocalWebRtcOverrideConfig(scope) : null;
    peer = new RTCPeerConnection(toRtcConfiguration(local ?? settings));
    const connection = peer;
    const readyChannel = connection.createDataChannel('ready');
    const ready = new Promise<void>((resolve, reject) => {
      readyChannel.onmessage = (event) => { if (event.data === 'ready') resolve(); else reject(new Error('Invalid WebRTC handshake')); };
      readyChannel.onclose = () => reject(new Error('WebRTC handshake channel closed'));
      readyChannel.onerror = () => reject(new Error('WebRTC handshake failed'));
      connection.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(connection.connectionState)) reject(new Error('WebRTC connection failed'));
      };
    });
    // 提前处理握手 Promise 的拒绝 避免 HTTP offer 交换失败时出现未处理的异常
    void ready.catch(() => {});
    await connection.setLocalDescription(await connection.createOffer());
    if (connection.iceGatheringState !== 'complete') {
      await waitWithSignal(new Promise<void>((resolve) => {
        connection.onicegatheringstatechange = () => { if (connection.iceGatheringState === 'complete') resolve(); };
      }), controller.signal);
      connection.onicegatheringstatechange = null;
    }
    const answer = await apiFetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connection.localDescription), signal: controller.signal, handleForbidden: false,
    });
    if (!answer.ok) throw new Error(`WebRTC offer rejected (${answer.status})`);
    await connection.setRemoteDescription(await answer.json());
    await waitWithSignal(ready, controller.signal);
    readyChannel.onmessage = null;
    readyChannel.onerror = null;
    readyChannel.onclose = null;
    connection.onconnectionstatechange = null;
    return new PeerDeviceConnection(connection);
  } catch (error) { peer?.close(); throw error; }
  finally { clearTimeout(timeout); }
}

interface PoolEntry { pending?: Promise<DeviceConnection | null>; connection?: DeviceConnection; unavailableUntil?: number; }

export class DeviceConnectionPool {
  private scope = '';
  private readonly entries = new Map<string, PoolEntry>();
  private readonly connect: (deviceID: string) => Promise<DeviceConnection>;
  private readonly getScope: () => string;
  constructor(
    connect: (deviceID: string) => Promise<DeviceConnection> = connectDevice,
    getScope: () => string = () => String(useAuth().currentUser.value?.Id ?? 'anonymous'),
  ) { this.connect = connect; this.getScope = getScope; }
  async acquire(deviceID: string, signal?: AbortSignal | null): Promise<DeviceConnection | null> {
    const scope = this.getScope();
    if (scope !== this.scope) { this.close(); this.scope = scope; }
    if (signal?.aborted) return waitWithSignal(Promise.resolve(null), signal);
    let entry = this.entries.get(deviceID);
    if (entry?.connection?.isOpen) return entry.connection;
    if (entry?.pending) return waitWithSignal(entry.pending, signal);
    if ((entry?.unavailableUntil ?? 0) > Date.now()) return null;
    entry?.connection?.close();
    entry = {};
    this.entries.set(deviceID, entry);
    const current = entry;
    current.pending = this.connect(deviceID).then((connection) => {
      if (this.entries.get(deviceID) !== current) { connection.close(); throw new Error('WebRTC account session changed'); }
      current.connection = connection;
      return connection;
    }).catch((error: unknown) => {
      if (this.entries.get(deviceID) !== current) throw new DOMException('Account session changed', 'AbortError');
      if (this.entries.get(deviceID) === current) current.unavailableUntil = Date.now() + UNAVAILABLE_CACHE_MS;
      if (!isAbortError(error)) console.info('WebRTC establishment failed; using HTTP/WS for new operations.', error);
      return null;
    }).finally(() => { current.pending = undefined; });
    return waitWithSignal(current.pending, signal);
  }
  close() {
    for (const entry of this.entries.values()) entry.connection?.close();
    this.entries.clear();
  }
}

export const deviceConnectionPool = new DeviceConnectionPool();
