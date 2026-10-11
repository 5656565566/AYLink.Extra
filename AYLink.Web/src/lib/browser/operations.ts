import { sanitizeDownloadFileName } from '../input/normalize';

export interface FileDownloadTarget {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export async function selectDownloadFile(fileName: string, fallbackFileName: string): Promise<FileDownloadTarget | null> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<FileDownloadTarget> }>;
  }).showSaveFilePicker;
  if (!picker) return null;
  // 在下载操作中、等待网络请求之前直接调用
  // 保留浏览器保存对话框所需的用户激活状态
  const handle = await picker.call(window, { suggestedName: sanitizeDownloadFileName(fileName, fallbackFileName) });
  return handle.createWritable();
}

export async function writeClipboardText(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is not available in the current browser context.');
  }

  await navigator.clipboard.writeText(text);
}

export function triggerBlobDownload(blob: Blob, fileName: string, fallbackFileName: string) {
  if (!document.body) {
    throw new Error('Document body is not available for download dispatch.');
  }

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = sanitizeDownloadFileName(fileName, fallbackFileName);
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
}

export function triggerUrlDownload(url: string, fileName: string, fallbackFileName: string) {
  if (!document.body) {
    throw new Error('Document body is not available for download dispatch.');
  }

  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = sanitizeDownloadFileName(fileName, fallbackFileName);
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
  }
}
