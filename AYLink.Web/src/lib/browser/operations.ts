import { sanitizeDownloadFileName } from '../input/normalize';

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
