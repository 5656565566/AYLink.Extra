import { sendApiRequestWithTransport, type ApiRequestOptions, type ApiRequestTransport } from '../../core/http/client';
import { uploadWithProgressTransport, type UploadFormDataOptions } from '../../lib/http/transfer';
import { deviceConnectionPool } from './connection';
import { useAuth } from '../../services/auth';
import { loadLocalWebRtcFileTransferPreferred } from '../../services/webrtcSettings';
import type { UploadProgress } from './channel';

function preferredTransport(fallback: ApiRequestTransport, onProgress?: (progress: UploadProgress) => void): ApiRequestTransport {
  return async (url, init) => {
    const match = /^\/api\/devices\/([^/]+)\//.exec(url);
    if (!match) throw new Error('Device transport requires a device URL');
    const scope = String(useAuth().currentUser.value?.Id ?? 'anonymous');
    if (!loadLocalWebRtcFileTransferPreferred(scope)) return fallback(url, init);
    const connection = await deviceConnectionPool.acquire(decodeURIComponent(match[1]), init.signal);
    // 仅在建连失败时回退到 HTTP RTC 请求失败后直接向上返回错误
    // 避免重复执行写操作或重新传输已开始上传的文件
    return connection ? connection.request(url, init, onProgress) : fallback(url, init);
  };
}

export function requestDevice(url: string, options: ApiRequestOptions = {}) {
  return sendApiRequestWithTransport(url, options, preferredTransport((url, init) => fetch(url, init)));
}

export async function uploadDeviceFile(url: string, formData: FormData, options: UploadFormDataOptions = {}) {
  const response = await sendApiRequestWithTransport(url, {
    method: options.method || 'POST', headers: options.headers, signal: options.signal, body: formData,
  }, preferredTransport(uploadWithProgressTransport(options.onProgress), options.onProgress));
  // 上传响应是较小的 JSON 文档 即使调用方只检查状态码 也先读完响应体
  // 确保当前 RTC 请求通道被关闭
  const body = await response.arrayBuffer();
  return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
}
