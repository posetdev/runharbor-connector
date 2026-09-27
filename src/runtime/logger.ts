type LogValue = string | number | boolean;
const allowedFields = new Set(['deploymentId', 'operationId', 'instanceId', 'errorCode', 'causeName', 'causeCode', 'event', 'state', 'terminalReason', 'timedOut', 'terminated', 'failures']);
export const log = {
  info(event: string, fields: Record<string, LogValue> = {}): void {
    const safeFields = Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => allowedFields.has(key) ? [[key, typeof value === 'string' ? value.slice(0, 200) : value]] : []));
    console.log(JSON.stringify({ event, ...safeFields }));
  },
};

/** A cause's name and code only: its message can carry a JIT config, a token or a URL. */
export function causeFields(cause: unknown): Record<string, string> {
  const value = cause as { name?: unknown; code?: unknown } | undefined;
  return {
    ...(typeof value?.name === 'string' ? { causeName: value.name } : {}),
    ...(typeof value?.code === 'string' ? { causeCode: value.code } : {}),
  };
}
