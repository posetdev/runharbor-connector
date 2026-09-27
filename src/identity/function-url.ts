import { AppError } from '../domain/errors.js';
import type { IamContext } from '../runtime/http.js';

/**
 * The one requestContext.authorizer.iam → CallerIdentity parse (05 §1.1).
 * saas-caller.ts and instance-caller.ts both build on parseAssumedRole
 * rather than re-parsing the ARN.
 */
export interface CallerIdentity {
  readonly accountId: string;
  readonly userArn: string;
  readonly sessionName?: string;
}

export interface AssumedRole {
  readonly accountId: string;
  readonly roleName: string;
  readonly sessionName: string;
}

export interface RoleIdentity {
  readonly accountId: string;
  readonly roleName: string;
}

const ASSUMED_ROLE_ARN = /^arn:(?:aws|aws-us-gov|aws-cn):sts::([0-9]{12}):assumed-role\/([^/]+)\/([^/]+)$/;
const ROLE_ARN = /^arn:(?:aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role\/(.+)$/;

export function parseCallerIdentity(caller: IamContext | null): CallerIdentity {
  const role = parseAssumedRole(caller);
  return { accountId: role.accountId, userArn: caller!.userArn!, sessionName: role.sessionName };
}

/** Parses the assumed-role ARN AWS places at requestContext.authorizer.iam.userArn. */
export function parseAssumedRole(caller: IamContext | null): AssumedRole {
  if (caller === null || typeof caller.userArn !== 'string') throw new AppError('UNAUTHENTICATED');
  const match = ASSUMED_ROLE_ARN.exec(caller.userArn);
  if (!match) throw new AppError('UNAUTHENTICATED');
  return { accountId: match[1]!, roleName: match[2]!, sessionName: match[3]! };
}

/** Extracts {accountId, roleName} from a plain (non-assumed) IAM role ARN, e.g. deployment config. */
export function roleIdentityFromArn(roleArn: string): RoleIdentity {
  const match = ROLE_ARN.exec(roleArn);
  if (!match) throw new AppError('INTERNAL');
  const path = match[2]!;
  const lastSlash = path.lastIndexOf('/');
  return { accountId: match[1]!, roleName: lastSlash === -1 ? path : path.slice(lastSlash + 1) };
}
