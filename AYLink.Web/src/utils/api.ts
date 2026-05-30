import { sendApiRequest, type ApiRequestOptions } from '../core/http/client';
import { readApiErrorMessage, resolveApiErrorMessage } from '../core/http/errors';

export { readApiErrorMessage, resolveApiErrorMessage };

export const apiFetch = async (url: string, options: ApiRequestOptions = {}): Promise<Response> => {
  return sendApiRequest(url, options);
};
