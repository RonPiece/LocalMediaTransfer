import { api, ApiRequestError } from '@/api/ApiClient';
import { PreflightAction } from '@/api/types';
import { nativeCapabilities } from '../NativeCapabilities';
import {
  DuplicateCheckStage,
  DuplicatePreflightMetrics,
  PreparedUploadFile,
  PreflightResult,
} from './types';
import { TransferErrorCode } from './errors';

const PREFLIGHT_BATCH_SIZE = 100;

export type DuplicateProgress = (progress: {
  stage: DuplicateCheckStage;
  completed: number;
  total: number;
}) => void;

export type OutgoingHashRegistry = Map<
  string,
  { transferFilename: string; receiverMatch?: string }
>;

function localCandidateIds(files: PreparedUploadFile[]): Set<string> {
  const ids = new Set<string>();
  const groups = new Map<number, PreparedUploadFile[]>();
  for (const file of files) {
    const group = groups.get(file.size) ?? [];
    group.push(file);
    groups.set(file.size, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const file of group) ids.add(file.variantId);
  }
  return ids;
}

export async function runDuplicatePreflightWindow({
  sessionRef = 'preflight-session',
  fileInfos,
  shouldSkipDuplicates,
  outgoingHashes = new Map(),
  onCheckingProgress = () => undefined,
}: {
  sessionRef?: string;
  fileInfos: PreparedUploadFile[];
  shouldSkipDuplicates: boolean;
  outgoingHashes?: OutgoingHashRegistry;
  onCheckingProgress?: DuplicateProgress;
}): Promise<PreflightResult> {
  const startedAt = Date.now();
  const preflightResults = new Map<string, PreflightAction>();
  const matchedFilenames = new Map<string, string>();
  const duplicateSources = new Map<
    string,
    'receiver-preflight' | 'outgoing-selection'
  >();
  const computedHashes = new Map<string, string>();
  const hashFailureCodes = new Map<string, TransferErrorCode>();
  const actuallyHashedIds = new Set<string>();
  let failureCount = 0;
  const metrics: DuplicatePreflightMetrics = {
    componentsConsidered: fileInfos.length,
    bypassedFiles: 0,
    metadataUploadFiles: 0,
    metadataFallbackFiles: 0,
    receiverCandidateFiles: 0,
    localCandidateFiles: 0,
    hashCandidateFiles: 0,
    hashedFiles: 0,
    hashAttemptCount: 0,
    hashCacheHits: 0,
    hashFailureFiles: 0,
    hashedBytes: 0,
    hashedThenUploadedFiles: 0,
    hashedThenUploadedBytes: 0,
    receiverSkippedFiles: 0,
    receiverSkippedBytes: 0,
    outgoingSkippedFiles: 0,
    outgoingSkippedBytes: 0,
    metadataRequestCount: 0,
    metadataFailureCount: 0,
    verificationRequestCount: 0,
    verificationFailureCount: 0,
    verificationInconclusiveFiles: 0,
    metadataDurationMs: 0,
    hashingDurationMs: 0,
    verificationDurationMs: 0,
    candidateResolutionDurationMs: 0,
    totalHashWorkerDurationMs: 0,
    longestHashDurationMs: 0,
    largestHashedFileBytes: 0,
    nonCandidateFilesBlockedByHash: 0,
    nonCandidateBytesBlockedByHash: 0,
    preparedBytesHeldDuringPreflight: fileInfos.reduce((total, file) => total + file.size, 0),
    temporaryBytesHeldDuringPreflight: fileInfos.reduce(
      (total, file) => total + (file.temporary ? file.size : 0),
      0,
    ),
  };

  if (!shouldSkipDuplicates) {
    for (const file of fileInfos) preflightResults.set(file.variantId, 'upload');
    metrics.bypassedFiles = fileInfos.length;
    return {
      preflightResults,
      matchedFilenames,
      duplicateSources,
      computedHashes,
      hashFailureCodes,
      preflightDurationMs: Date.now() - startedAt,
      failureCount,
      candidateCount: 0,
      checkedCount: 0,
      metrics,
    };
  }

  const fileById = new Map(fileInfos.map(file => [file.variantId, file]));
  const captureOutcomeMetrics = () => {
    for (const file of fileInfos) {
      const action = preflightResults.get(file.variantId) ?? 'upload';
      const source = duplicateSources.get(file.variantId);
      if (computedHashes.has(file.variantId) && action === 'upload') {
        metrics.hashedThenUploadedFiles += 1;
        metrics.hashedThenUploadedBytes += file.size;
      }
      if (action !== 'skip') continue;
      if (source === 'outgoing-selection') {
        metrics.outgoingSkippedFiles += 1;
        metrics.outgoingSkippedBytes += file.size;
      } else {
        metrics.receiverSkippedFiles += 1;
        metrics.receiverSkippedBytes += file.size;
      }
    }
  };
  const receiverCandidateIds = new Set<string>();
  const payload = fileInfos.map(file => ({
    id: file.variantId,
    name: file.transferFilename,
    size: file.size,
  }));
  onCheckingProgress({ stage: 'finding-matches', completed: 0, total: payload.length });
  let metadataCompleted = 0;
  for (let index = 0; index < payload.length; index += PREFLIGHT_BATCH_SIZE) {
    const batch = payload.slice(index, index + PREFLIGHT_BATCH_SIZE);
    const requestStartedAt = Date.now();
    metrics.metadataRequestCount += 1;
    try {
      const response = await api.preflightCheck(batch);
      const idsWithResults = new Set<string>();
      for (const result of response.files) {
        idsWithResults.add(result.id);
        if (result.action === 'hash_required') {
          receiverCandidateIds.add(result.id);
          preflightResults.set(result.id, 'hash_required');
        } else {
          preflightResults.set(result.id, result.action);
          if (result.action === 'upload') metrics.metadataUploadFiles += 1;
          if (result.action === 'skip' && result.filename) {
            matchedFilenames.set(result.id, result.filename);
            duplicateSources.set(result.id, 'receiver-preflight');
          }
        }
      }
      for (const file of batch) {
        if (!idsWithResults.has(file.id)) {
          preflightResults.set(file.id, 'upload');
          metrics.metadataFallbackFiles += 1;
        }
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) throw error;
      failureCount += 1;
      metrics.metadataFailureCount += 1;
      metrics.metadataFallbackFiles += batch.length;
      for (const file of batch) preflightResults.set(file.id, 'upload');
    } finally {
      metrics.metadataDurationMs += Date.now() - requestStartedAt;
      metadataCompleted += batch.length;
      onCheckingProgress({
        stage: 'finding-matches',
        completed: metadataCompleted,
        total: payload.length,
      });
    }
  }
  metrics.receiverCandidateFiles = receiverCandidateIds.size;
  const candidateResolutionStartedAt = Date.now();

  if (!nativeCapabilities.available) {
    for (const id of receiverCandidateIds) preflightResults.set(id, 'upload');
    captureOutcomeMetrics();
    return {
      preflightResults,
      matchedFilenames,
      duplicateSources,
      computedHashes,
      hashFailureCodes,
      preflightDurationMs: Date.now() - startedAt,
      failureCount,
      candidateCount: receiverCandidateIds.size,
      checkedCount: 0,
      metrics: {
        ...metrics,
        candidateResolutionDurationMs: Date.now() - candidateResolutionStartedAt,
      },
    };
  }

  const localCandidates = localCandidateIds(fileInfos);
  metrics.localCandidateFiles = localCandidates.size;
  const candidateIds = new Set(localCandidates);
  for (const id of receiverCandidateIds) candidateIds.add(id);
  const candidates = Array.from(candidateIds)
    .map(id => fileById.get(id))
    .filter((file): file is PreparedUploadFile => file !== undefined);
  metrics.hashCandidateFiles = candidates.length;
  if (candidates.length > 0) {
    const nonCandidates = fileInfos.filter(file => !candidateIds.has(file.variantId));
    metrics.nonCandidateFilesBlockedByHash = nonCandidates.length;
    metrics.nonCandidateBytesBlockedByHash = nonCandidates.reduce(
      (total, file) => total + file.size,
      0,
    );
  }
  let checkedCount = 0;
  if (candidates.length > 0) {
    onCheckingProgress({
      stage: 'checking-contents',
      completed: checkedCount,
      total: candidates.length,
    });
  }

  const hashingStartedAt = Date.now();
  for (let index = 0; index < candidates.length; index += PREFLIGHT_BATCH_SIZE) {
    const batch = candidates.slice(index, index + PREFLIGHT_BATCH_SIZE);
    try {
      const requests = batch.map(file => ({
        variantId: file.variantId,
        localUri: file.nativeUri,
        expectedSizeBytes: file.size,
      }));
      const recordHashResults = (
        results: Awaited<ReturnType<typeof nativeCapabilities.hashPreparedFiles>>,
        attemptedRequests: typeof requests,
      ) => {
        metrics.hashAttemptCount += attemptedRequests.length;
        const requestsById = new Map(attemptedRequests.map(request => [request.variantId, request]));
        for (const result of results) {
          const request = requestsById.get(result.variantId);
          if (!request) continue;
          const durationMs = Number.isFinite(result.durationMs) ? result.durationMs : 0;
          const reportedBytes = Number.isFinite(result.bytesRead)
            ? result.bytesRead
            : result.status === 'success'
              ? request.expectedSizeBytes
              : 0;
          metrics.hashedBytes += reportedBytes;
          metrics.totalHashWorkerDurationMs += durationMs;
          metrics.longestHashDurationMs = Math.max(metrics.longestHashDurationMs, durationMs);
          if (result.status === 'success' && result.cacheHit) metrics.hashCacheHits += 1;
          if (reportedBytes > 0 || (result.status === 'success' && !result.cacheHit)) {
            actuallyHashedIds.add(result.variantId);
            metrics.largestHashedFileBytes = Math.max(
              metrics.largestHashedFileBytes,
              request.expectedSizeBytes,
            );
          }
        }
      };
      let results = await nativeCapabilities.hashPreparedFiles(
        sessionRef,
        requests,
      );
      recordHashResults(results, requests);
      const changedIds = new Set(results
        .filter(result => result.status === 'failed' && result.errorCode === 'file-changed')
        .map(result => result.variantId));
      if (changedIds.size > 0) {
        const retried = await nativeCapabilities.hashPreparedFiles(
          sessionRef,
          requests.filter(request => changedIds.has(request.variantId)),
        );
        recordHashResults(
          retried,
          requests.filter(request => changedIds.has(request.variantId)),
        );
        const retriedById = new Map(retried.map(result => [result.variantId, result]));
        results = results.map(result => retriedById.get(result.variantId) ?? result);
      }
      for (const result of results) {
        if (result.status === 'success') {
          computedHashes.set(result.variantId, result.sha256);
        } else if (result.errorCode !== 'cancelled') {
          hashFailureCodes.set(result.variantId, result.errorCode);
        }
      }
    } catch {
      failureCount += 1;
      for (const file of batch) {
        hashFailureCodes.set(file.variantId, 'native-hashing-unavailable');
      }
    }
    checkedCount += batch.length;
    onCheckingProgress({
      stage: 'checking-contents',
      completed: checkedCount,
      total: candidates.length,
    });
  }
  metrics.hashingDurationMs = candidates.length > 0 ? Date.now() - hashingStartedAt : 0;
  metrics.hashedFiles = actuallyHashedIds.size;
  metrics.hashFailureFiles = hashFailureCodes.size;

  const verificationPayload = Array.from(receiverCandidateIds)
    .map(id => {
      const file = fileById.get(id);
      const sha256 = computedHashes.get(id);
      return file && sha256
        ? { id, name: file.transferFilename, size: file.size, sha256 }
        : null;
    })
    .filter((file): file is NonNullable<typeof file> => file !== null);

  const verificationStartedAt = Date.now();
  let verificationCompleted = 0;
  if (verificationPayload.length > 0) {
    onCheckingProgress({
      stage: 'verifying-windows',
      completed: 0,
      total: verificationPayload.length,
    });
  }
  for (let index = 0; index < verificationPayload.length; index += PREFLIGHT_BATCH_SIZE) {
    const batch = verificationPayload.slice(index, index + PREFLIGHT_BATCH_SIZE);
    metrics.verificationRequestCount += 1;
    try {
      const response = await api.preflightVerify(batch);
      const returned = new Set<string>();
      for (const result of response.files) {
        returned.add(result.id);
        if (result.verification === 'inconclusive') {
          failureCount += 1;
          metrics.verificationInconclusiveFiles += 1;
        }
        preflightResults.set(result.id, result.action === 'hash_required' ? 'upload' : result.action);
        if (result.action === 'skip') {
          duplicateSources.set(result.id, 'receiver-preflight');
          if (result.filename) matchedFilenames.set(result.id, result.filename);
        }
      }
      for (const file of batch) {
        if (!returned.has(file.id)) preflightResults.set(file.id, 'upload');
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) throw error;
      failureCount += 1;
      metrics.verificationFailureCount += 1;
      for (const file of batch) preflightResults.set(file.id, 'upload');
    } finally {
      verificationCompleted += batch.length;
      onCheckingProgress({
        stage: 'verifying-windows',
        completed: verificationCompleted,
        total: verificationPayload.length,
      });
    }
  }
  metrics.verificationDurationMs = verificationPayload.length > 0
    ? Date.now() - verificationStartedAt
    : 0;
  for (const id of receiverCandidateIds) {
    if (!computedHashes.has(id)) preflightResults.set(id, 'upload');
  }

  const filesByHash = new Map<string, PreparedUploadFile[]>();
  for (const file of fileInfos) {
    const hash = computedHashes.get(file.variantId);
    if (!hash) continue;
    const group = filesByHash.get(hash) ?? [];
    group.push(file);
    filesByHash.set(hash, group);
  }
  for (const group of filesByHash.values()) {
    const hash = computedHashes.get(group[0].variantId);
    if (!hash) continue;
    const earlier = outgoingHashes.get(hash);
    const receiverMatch = group
      .map(file => matchedFilenames.get(file.variantId))
      .find((filename): filename is string => Boolean(filename)) ?? earlier?.receiverMatch;
    if (receiverMatch) {
      for (const file of group) {
        preflightResults.set(file.variantId, 'skip');
        matchedFilenames.set(file.variantId, receiverMatch);
        duplicateSources.set(file.variantId, 'receiver-preflight');
      }
      outgoingHashes.set(hash, {
        transferFilename: earlier?.transferFilename ?? group[0].transferFilename,
        receiverMatch,
      });
      continue;
    }
    if (earlier) {
      for (const file of group) {
        preflightResults.set(file.variantId, 'skip');
        matchedFilenames.set(file.variantId, earlier.transferFilename);
        duplicateSources.set(file.variantId, 'outgoing-selection');
      }
      continue;
    }
    const [canonical, ...duplicates] = group;
    outgoingHashes.set(hash, { transferFilename: canonical.transferFilename });
    for (const file of duplicates) {
      preflightResults.set(file.variantId, 'skip');
      matchedFilenames.set(file.variantId, canonical.transferFilename);
      duplicateSources.set(file.variantId, 'outgoing-selection');
    }
  }

  captureOutcomeMetrics();
  metrics.candidateResolutionDurationMs = Date.now() - candidateResolutionStartedAt;

  return {
    preflightResults,
    matchedFilenames,
    duplicateSources,
    computedHashes,
    hashFailureCodes,
    preflightDurationMs: Date.now() - startedAt,
    failureCount,
    candidateCount: candidates.length,
    checkedCount,
    metrics,
  };
}
