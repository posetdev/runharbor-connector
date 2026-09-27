import { claimJit } from '../usecases/jit-claim.js';
import { getJitReadiness } from '../usecases/jit-readiness.js';
import { ec2Adapter, operationStore } from './compose.js';
import { config } from './config.js';

export function composeRunner() {
  const operations = operationStore();
  return {
    config,
    readiness: getJitReadiness.bind(null, operations),
    claim: claimJit.bind(null, operations, ec2Adapter()),
  };
}
