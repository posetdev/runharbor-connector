import { AppError } from '../domain/errors.js';

export type FunctionUrlResponse = Readonly<{ statusCode: number; headers: Record<string, string>; cookies?: readonly string[]; body: string }>;
export type FunctionUrlRequest = Readonly<{ method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: Buffer; caller: IamContext | null }>;
export type IamContext = Readonly<{ userArn?: string; principalOrgId?: string }>;

const MAX_BODY_BYTES = 256 * 1024;

export function parseFunctionUrlEvent(event: unknown): FunctionUrlRequest {
  const value = event as Record<string, unknown>;
  const context = value.requestContext as Record<string, unknown> | undefined;
  const http = context?.http as Record<string, unknown> | undefined;
  if (typeof value.rawPath !== 'string' || typeof http?.method !== 'string') throw new AppError('BAD_REQUEST');
  const headers = withCookies(normalizeHeaders(value.headers), value.cookies);
  const body = decodeBody(value.body, value.isBase64Encoded === true);
  const query = normalizeQuery(value.queryStringParameters);
  const iam = (context?.authorizer as Record<string, unknown> | undefined)?.iam as Record<string, unknown> | undefined;
  return { method: http.method, path: value.rawPath, query, headers, body, caller: iam === undefined ? null : { userArn: stringField(iam.userArn), principalOrgId: stringField(iam.principalOrgId) } };
}

export function parseJsonBody(request: FunctionUrlRequest): unknown {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new AppError('BAD_REQUEST');
  try { return JSON.parse(request.body.toString('utf8')); } catch { throw new AppError('BAD_REQUEST'); }
}

export function json(statusCode: number, body: unknown): FunctionUrlResponse {
  return { statusCode, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

export function errorResponse(error: AppError): FunctionUrlResponse {
  return json(error.httpStatus, { error: { code: error.code, retryable: error.retryable, ...(error.publicReason === undefined ? {} : { reason: error.publicReason }) } });
}

function decodeBody(value: unknown, base64: boolean): Buffer {
  if (value !== undefined && typeof value !== 'string') throw new AppError('BAD_REQUEST');
  try {
    const body = Buffer.from(value ?? '', base64 ? 'base64' : 'utf8');
    if (body.length > MAX_BODY_BYTES) throw new AppError('PAYLOAD_TOO_LARGE');
    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('BAD_REQUEST');
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new AppError('BAD_REQUEST');
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => typeof item === 'string' ? [[key.toLowerCase(), item]] : []));
}

/** Function URL payload 2.0 sends request cookies as an event.cookies array, not a cookie header; accept either shape. */
function withCookies(headers: Record<string, string>, cookies: unknown): Record<string, string> {
  const parts = [...(headers.cookie === undefined ? [] : [headers.cookie]), ...(Array.isArray(cookies) ? cookies.filter((item): item is string => typeof item === 'string') : [])];
  return parts.length === 0 ? headers : { ...headers, cookie: parts.join('; ') };
}

function normalizeQuery(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new AppError('BAD_REQUEST');
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => typeof item === 'string' ? [[key, item]] : []));
}

function stringField(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
