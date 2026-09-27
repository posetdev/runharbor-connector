import { AppError } from '../../domain/errors.js';
import { LINUX_X64_BOOTSTRAP_ARTIFACT } from './bootstrap-artifact.generated.js';

export const EC2_RAW_USER_DATA_MAX_BYTES = 16 * 1024;

export type LinuxUserDataInput = Readonly<{ region: string; runnerFunctionUrl: string; operationId: string }>;

const REGION = /^[a-z]{2}(-[a-z]+)+-[0-9]$/;
const OPERATION_ID = /^op_[0-9a-f]{64}$/;

/**
 * The whole cloud-init shell payload: reviewed bootstrap sources plus three
 * operation-bound values, none of them caller-controlled. Returns raw UTF-8 so
 * the 16 KiB limit is checked before launch-params base64-encodes it once.
 */
export function renderLinuxX64UserData(input: LinuxUserDataInput): string {
  const claimUrl = claimUrlFor(input.runnerFunctionUrl, input.region);
  if (!OPERATION_ID.test(input.operationId)) throw new AppError('INTERNAL');
  const userData = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'set +x',
    // The host is always the Canonical Ubuntu 24.04 LTS image Terraform resolved
    // from the public SSM parameter, so the package set and the package manager
    // are both fixed here: apt on noble, with the .NET dependency names of that
    // release. The check stays because a name is not a filesystem: an image that
    // is not Ubuntu 24.04 must fail here with its own package manager named,
    // rather than much later as an opaque runner crash on a missing libicu.
    'if [ ! -x /usr/bin/apt-get ]; then',
    "  printf '%s\\n' 'runharbor-user-data: this image has no apt-get; only Ubuntu 24.04 LTS is supported' >&2; exit 1",
    'fi',
    'export DEBIAN_FRONTEND=noninteractive',
    '/usr/bin/apt-get update -qq',
    '/usr/bin/apt-get install -y --no-install-recommends bash ca-certificates coreutils curl findutils gzip passwd python3 sudo tar util-linux libicu74 libssl3t64 libkrb5-3 zlib1g liblttng-ust1t64',
    '/usr/bin/install -d -o root -g root -m 0700 /opt/runharbor/bootstrap /etc/runharbor',
    writeGzip('/opt/runharbor/bootstrap/linux-x64-runner.sh', LINUX_X64_BOOTSTRAP_ARTIFACT.runnerGzipBase64),
    writeGzip('/opt/runharbor/bootstrap/linux-x64-claim.py', LINUX_X64_BOOTSTRAP_ARTIFACT.claimGzipBase64),
    '/usr/bin/chown root:root /opt/runharbor/bootstrap/linux-x64-runner.sh /opt/runharbor/bootstrap/linux-x64-claim.py',
    '/usr/bin/chmod 0755 /opt/runharbor/bootstrap/linux-x64-runner.sh /opt/runharbor/bootstrap/linux-x64-claim.py',
    `(umask 077; printf '%s\\n' 'RUNHARBOR_REGION=${input.region}' 'RUNHARBOR_CLAIM_URL=${claimUrl}' 'RUNHARBOR_OPERATION_ID=${input.operationId}' > /etc/runharbor/linux-x64-runner.conf)`,
    '/usr/bin/chown root:root /etc/runharbor/linux-x64-runner.conf',
    '/usr/bin/chmod 0600 /etc/runharbor/linux-x64-runner.conf',
    '/opt/runharbor/bootstrap/linux-x64-runner.sh',
    '',
  ].join('\n');
  if (Buffer.byteLength(userData, 'utf8') > EC2_RAW_USER_DATA_MAX_BYTES) throw new AppError('INTERNAL');
  return userData;
}

/** config.runnerClaimUrl is the runner Function URL root (02 §2); the bootstrap wants its /jit/claim route. */
function claimUrlFor(runnerFunctionUrl: string, region: string): string {
  const match = /^https:\/\/([a-z0-9]{26}|[a-z0-9]{32})\.lambda-url\.([a-z]{2}(?:-[a-z]+)+-[0-9])\.on\.aws\/$/.exec(runnerFunctionUrl);
  if (!REGION.test(region) || match === null || match[2] !== region) throw new AppError('INTERNAL');
  return `${runnerFunctionUrl}jit/claim`;
}

function writeGzip(path: string, gzipBase64: string): string {
  return `printf '%s' '${gzipBase64}' | /usr/bin/base64 --decode | /bin/gzip --decompress > ${path}`;
}
