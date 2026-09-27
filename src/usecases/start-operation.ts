import type { StartRequest, StartResponse } from '@runharbor/contracts';
import type { Clock } from '../domain/clock.js';
import { AppError } from '../domain/errors.js';
import {
  acceptedOperation, deriveOperationId, ec2ClientToken, isInstanceGone, isTakeoverAllowed, isTerminal, terminalTtl,
  type OperationPatch, type OperationRecord, type OperationState,
} from '../domain/operation.js';
import type { Ec2Port } from '../ports/ec2.js';
import { REQUIRED_INSTALLATION_PERMISSIONS, type GitHubPort } from '../ports/github.js';
import { ConditionalWriteError, type OperationStore } from '../ports/operation-store.js';
import type { SchedulerPort } from '../ports/scheduler.js';
import type { SecretsPort } from '../ports/secrets.js';
import { errorFields, silentLogger, type UsecaseLogger } from './log.js';

type FailureReason = 'admission_failed' | 'launch_failed' | 'jit_failed';

/**
 * GitHub gives these to a runner registered with config.sh, but never to a JIT
 * runner: `generate-jitconfig` grants exactly the labels it is handed. A job
 * asking for `runs-on: [self-hosted, Linux, X64, <runner label>]` therefore
 * never matches a runner registered with the runner label alone — it sits
 * queued forever beside an idle `online` runner, with nothing logged anywhere.
 * Matched case-insensitively because `runs-on` matching is, but the job's own
 * spelling is what gets registered.
 */
const GITHUB_DEFAULT_LABELS = new Set(['self-hosted', 'linux', 'windows', 'macos', 'x64', 'arm', 'arm64']);

type Run = Readonly<{
  request: StartRequest; operationId: string; store: OperationStore; ec2: Ec2Port; github: GitHubPort; secrets: SecretsPort;
  scheduler: SchedulerPort; clock: Clock; githubAppParameterName: string;
  timeoutFunctionArn: string; schedulerRoleArn: string; scheduleGroupName: string; log: UsecaseLogger;
}>;

/**
 * The resumable start (D2). The caller has already run authorizeStart. Every
 * call reads the operation and performs only the steps its persisted state
 * still lacks, each committed with a revision CAS; `replay` is true whenever
 * the operation existed before this call. `maxDurationMs` is the whole
 * timeout budget, so `timeoutAt = now + maxDurationMs`.
 */
export async function startOperation(
  request: StartRequest,
  operationStore: OperationStore,
  ec2: Ec2Port,
  github: GitHubPort,
  secrets: SecretsPort,
  scheduler: SchedulerPort,
  clock: Clock,
  githubAppParameterName: string,
  maxDurationMs: number,
  timeoutFunctionArn: string,
  schedulerRoleArn: string,
  scheduleGroupName: string,
  log: UsecaseLogger = silentLogger,
): Promise<StartResponse> {
  const run: Run = {
    request, operationId: deriveOperationId(request.deploymentId, request.job), store: operationStore, ec2, github, secrets, scheduler,
    clock, githubAppParameterName, timeoutFunctionArn, schedulerRoleArn, scheduleGroupName, log,
  };
  const existing = await operationStore.get(run.operationId);
  if (existing === undefined) return resume(run, await accept(run, maxDurationMs), false);
  if (existing.idempotencyKey !== request.idempotencyKey) throw new AppError('IDEMPOTENCY_MISMATCH');
  if (isTerminal(existing.state) || existing.state === 'ready') return respond(existing, true);
  if (!isTakeoverAllowed(existing, clock.now())) throw new AppError('IN_PROGRESS');
  return resume(run, existing, true);
}

/**
 * Admission, then the `accepted` record. A job GitHub permanently rejects is
 * recorded as failed(admission_failed) before JOB_NOT_ELIGIBLE is thrown; a
 * retryable GitHub error leaves no record, so the retry admits afresh.
 */
async function accept(run: Run, maxDurationMs: number): Promise<OperationRecord> {
  const { request } = run;
  const rejection = await admit(run).then(() => undefined, (error: unknown) => {
    const appError = AppError.from(error);
    if (appError.code !== 'JOB_NOT_ELIGIBLE') throw appError;
    return appError;
  });
  const record = acceptedOperation({
    operationId: run.operationId, deploymentId: request.deploymentId, runnerLabel: request.runnerLabel, instanceType: request.instanceType,
    idempotencyKey: request.idempotencyKey, job: request.job, timeoutAfterMs: maxDurationMs, now: run.clock.now(),
  });
  let created: OperationRecord;
  try {
    created = await run.store.create(record);
  } catch (error) {
    if (error instanceof ConditionalWriteError) throw new AppError('IN_PROGRESS');
    throw error;
  }
  if (rejection === undefined) return created;
  await failAfter(run, created, 'admission_failed', rejection);
  throw rejection;
}

/** 03 §C1: the job is queued in the requested run attempt, carries its runner label, and its run has not concluded. */
async function admit(run: Run): Promise<void> {
  const { job } = run.request;
  const { owner, repo } = splitRepository(job.repositoryFullName);
  const token = await installationToken(run, repo);
  const workflowJob = await run.github.getJob(owner, repo, job.jobId, token);
  if (workflowJob.runId !== job.runId || workflowJob.runAttempt !== job.runAttempt) throw new AppError('JOB_NOT_ELIGIBLE');
  if (workflowJob.status !== 'queued' || workflowJob.conclusion !== null) throw new AppError('JOB_NOT_ELIGIBLE');
  if (!workflowJob.labels.includes(run.request.runnerLabel)) throw new AppError('JOB_NOT_ELIGIBLE');
  const workflowRun = await run.github.getRun(owner, repo, job.runId, token);
  if (workflowRun.id !== job.runId || workflowRun.conclusion !== null) throw new AppError('JOB_NOT_ELIGIBLE');
}

async function resume(run: Run, record: OperationRecord, replay: boolean): Promise<StartResponse> {
  let current = record;
  if (current.state === 'accepted') current = await launch(run, current);
  if (current.state === 'launched') current = await prepareRunner(run, current);
  return respond(current, replay);
}

/** accepted → launched. ClientToken makes RunInstances idempotent; DescribeInstances finds what a crash or lost response left behind. */
async function launch(run: Run, record: OperationRecord): Promise<OperationRecord> {
  const token = ec2ClientToken(run.operationId);
  const existing = await run.ec2.describeByClientToken(token);
  if (existing !== undefined && isInstanceGone(existing)) return fail(run, record, 'launch_failed');
  let instanceId = existing?.instanceId;
  if (instanceId === undefined) {
    try {
      instanceId = (await run.ec2.runInstances(token, record.runnerLabel, record.instanceType)).instanceId;
    } catch (error) {
      const recovered = await run.ec2.describeByClientToken(token).catch(() => undefined);
      if (recovered !== undefined && !isInstanceGone(recovered)) instanceId = recovered.instanceId;
      else if (isPermanent(error)) return failAfter(run, record, 'launch_failed', error);
      else throw AppError.from(error);
    }
  }
  return save(run, record, 'launched', { instanceId });
}

/** launched → ready: JIT config onto the operation, then the one-time timeout schedule (best effort). */
async function prepareRunner(run: Run, record: OperationRecord): Promise<OperationRecord> {
  const { owner, repo } = splitRepository(record.job.repositoryFullName);
  let jitConfig: string;
  try {
    const token = await installationToken(run, repo);
    const workflowJob = await run.github.getJob(owner, repo, record.job.jobId, token);
    jitConfig = await run.github.generateJitConfig(owner, repo, record.runnerName, registrationLabels(record.runnerLabel, workflowJob.labels), token);
  } catch (error) {
    if (isPermanent(error)) return failAfter(run, record, 'jit_failed', error);
    throw AppError.from(error);
  }
  let scheduleName: string | undefined;
  try {
    scheduleName = await run.scheduler.createOneTimeSchedule(run.operationId, record.timeoutAt, run.timeoutFunctionArn, run.schedulerRoleArn, run.scheduleGroupName);
  } catch (error) {
    // The hourly sweep still bounds the instance; the operation must not fail for this (04 §1).
    run.log.info('timeout_schedule_failed', { operationId: run.operationId, ...errorFields(error) });
  }
  return save(run, record, 'ready', scheduleName === undefined ? { jitConfig } : { jitConfig, scheduleName });
}

async function failAfter(run: Run, record: OperationRecord, reason: FailureReason, error: unknown): Promise<OperationRecord> {
  run.log.info('operation_failed', { operationId: run.operationId, terminalReason: reason, ...errorFields(error) });
  return fail(run, record, reason);
}

/** `* → failed`, terminating the instance first when one was recorded. */
async function fail(run: Run, record: OperationRecord, reason: FailureReason): Promise<OperationRecord> {
  const now = run.clock.now();
  if (record.instanceId !== undefined) await run.ec2.terminate(record.instanceId, record.deploymentId);
  return save(run, record, 'failed', { terminalReason: reason, ttl: terminalTtl(now), ...(record.instanceId === undefined ? {} : { terminatedAt: now }) });
}

async function save(run: Run, record: OperationRecord, to: OperationState, patch: OperationPatch): Promise<OperationRecord> {
  try {
    return await run.store.advance(record, to, { ...patch, updatedAt: run.clock.now() });
  } catch (error) {
    if (error instanceof ConditionalWriteError) throw new AppError('IN_PROGRESS');
    throw error;
  }
}

/** The installation id was checked against the deployment by authorizeStart. */
async function installationToken(run: Run, repo: string): Promise<string> {
  const credentials = await run.secrets.readAppCredentials(run.githubAppParameterName);
  const token = await run.github.installationToken({
    appId: credentials.appId, pem: credentials.pem, installationId: run.request.job.githubInstallationId,
    repositories: [repo], permissions: REQUIRED_INSTALLATION_PERMISSIONS,
  });
  return token.token;
}

function respond(record: OperationRecord, replay: boolean): StartResponse {
  return {
    apiVersion: 'runharbor.start.v1', operationId: record.pk.slice(3), state: record.state, replay,
    ...(record.instanceId === undefined ? {} : { instanceId: record.instanceId }),
    ...(record.terminalReason === undefined ? {} : { terminalReason: record.terminalReason }),
  };
}

/**
 * The requested runner label, plus any GitHub default label this job also asks for.
 * Admission already proved the runner label is present on the job, but
 * a subset is not enough to be scheduled: the runner must carry every label in
 * `runs-on`. Only GitHub's own default labels are added, so a job asking for
 * something like `gpu` is still never told this runner has it.
 */
function registrationLabels(runnerLabel: string, jobLabels: readonly string[]): readonly string[] {
  const seen = new Set([runnerLabel.toLowerCase()]);
  return jobLabels.reduce<string[]>((labels, label) => {
    const key = label.toLowerCase();
    if (!GITHUB_DEFAULT_LABELS.has(key) || seen.has(key)) return labels;
    seen.add(key);
    return [...labels, label];
  }, [runnerLabel]);
}

function isPermanent(error: unknown): boolean {
  return error instanceof AppError && !error.retryable;
}

function splitRepository(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (owner === undefined || repo === undefined) throw new AppError('BAD_REQUEST');
  return { owner, repo };
}
