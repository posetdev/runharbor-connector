import { AppError } from '../domain/errors.js';
import { parseAssumedRole, roleIdentityFromArn } from './function-url.js';
import type { IamContext } from '../runtime/http.js';

const INSTANCE_ID = /^i-[0-9a-f]{8,17}$/;

/**
 * assumed-role/<runnerRoleName>/<instanceId> → instanceId (02 §2 format).
 * AWS sets the STS session name to the EC2 instance id for an instance
 * profile caller, so the ARN's third segment is trusted only after the
 * account and role name are confirmed to match config.runnerRoleArn.
 */
export function resolveInstanceCaller(caller: IamContext | null, runnerRoleArn: string): string {
  const role = parseAssumedRole(caller);
  const expected = roleIdentityFromArn(runnerRoleArn);
  if (role.accountId !== expected.accountId || role.roleName !== expected.roleName || !INSTANCE_ID.test(role.sessionName)) {
    throw new AppError('FORBIDDEN');
  }
  return role.sessionName;
}
