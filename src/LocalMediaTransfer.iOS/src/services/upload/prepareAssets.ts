import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { MediaAsset } from '../MediaScanner';
import { nativeCapabilities } from '../NativeCapabilities';
import { TransferErrorCode } from './errors';
import {
  GlobalProgress,
  PreparationFailure,
  PreparationResult,
  PreparedUploadFile,
  PreparedWindow,
} from './types';

export const NATIVE_FILENAME_BATCH_SIZE = 250;
export const METADATA_CONCURRENCY = 8;

async function getNativeFileUri(asset: MediaAsset): Promise<string> {
  try {
    const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
    if (assetInfo?.localUri) return assetInfo.localUri;
  } catch {
    // The picker URI can still be a valid current rendition. File-system
    // validation below decides whether this item can proceed.
  }
  return asset.uri;
}

function preparationFailure(
  asset: MediaAsset,
  fileRef: number,
  windowIndex: number,
  stage: PreparationFailure['stage'],
  code: TransferErrorCode,
  itemId = `${asset.id}:failure:${fileRef}`,
): PreparationFailure {
  return { asset, itemId, fileRef, windowIndex, stage, code };
}

export async function prepareAssetWindow({
  assets,
  sessionRef,
  startIndex,
  windowIndex,
  totalSelectedFiles,
  alreadyPreparedFiles,
  alreadyReadyFiles = 0,
  alreadyDiscoveredBytes,
  includeAdditionalMediaComponents = false,
  isCancelled,
  onGlobalProgress,
}: {
  assets: MediaAsset[];
  sessionRef: string;
  startIndex: number;
  windowIndex: number;
  totalSelectedFiles: number;
  alreadyPreparedFiles: number;
  alreadyReadyFiles?: number;
  alreadyDiscoveredBytes: number;
  includeAdditionalMediaComponents?: boolean;
  isCancelled: () => boolean;
  onGlobalProgress: (progress: GlobalProgress) => void;
}): Promise<PreparedWindow | null> {
  if (assets.length > NATIVE_FILENAME_BATCH_SIZE) {
    throw new Error(`Preparation window exceeds ${NATIVE_FILENAME_BATCH_SIZE} assets`);
  }

  const startedAt = Date.now();
  if (
    nativeCapabilities.available &&
    typeof nativeCapabilities.prepareAssetWindow === 'function'
  ) {
    const results = await nativeCapabilities.prepareAssetWindow(
      sessionRef,
      assets.map((asset, localIndex) => ({
        fileRef: startIndex + localIndex + 1,
        assetId: asset.id,
      })),
      { includeAdditionalMediaComponents },
      (completedAssets, nativeTotalAssets) => {
        if (isCancelled() || nativeTotalAssets !== assets.length) return;
        const clampedCompleted = Math.max(0, Math.min(assets.length, completedAssets));
        const currentAsset = assets[Math.max(0, clampedCompleted - 1)] ?? assets[0];
        if (!currentAsset) return;
        onGlobalProgress({
          bytesSent: 0,
          totalBytes: 0,
          acknowledgedMediaBytes: 0,
          plannedUploadMediaBytes: 0,
          rateSampledAt: 0,
          currentMediaMBps: 0,
          averageMediaMBps: 0,
          peakMediaMBps: 0,
          currentEncodedMBps: 0,
          currentIndex: alreadyPreparedFiles + clampedCompleted,
          currentAsset,
          status: 'preparing',
          preparedFiles: alreadyPreparedFiles + clampedCompleted,
          readyFiles: alreadyReadyFiles,
          totalFiles: totalSelectedFiles,
          preparationComplete: false,
          discoveredBytes: alreadyDiscoveredBytes,
          thermalState: 'nominal',
          thermalControl: 'normal',
        });
      },
    );
    if (isCancelled()) return null;
    const resultsByAssetId = new Map<string, typeof results>();
    const resultsByFileRef = new Map<number, typeof results>();
    for (const result of results) {
      if (result.assetId) {
        const group = resultsByAssetId.get(result.assetId) ?? [];
        group.push(result);
        resultsByAssetId.set(result.assetId, group);
      } else {
        const group = resultsByFileRef.get(result.fileRef) ?? [];
        group.push(result);
        resultsByFileRef.set(result.fileRef, group);
      }
    }
    const files: PreparedUploadFile[] = [];
    const failures: PreparationFailure[] = [];
    let discoveredBytes = 0;
    let selectedMediaBytes = 0;
    let additionalComponentsBytes = 0;
    let readyInWindow = 0;
    for (let localIndex = 0; localIndex < assets.length; localIndex += 1) {
      const asset = assets[localIndex];
      const sourceFileRef = startIndex + localIndex + 1;
      const assetResults = resultsByAssetId.get(asset.id)
        ?? resultsByFileRef.get(sourceFileRef)
        ?? [];
      if (assetResults.length === 0) {
        failures.push(preparationFailure(
          asset,
          sourceFileRef,
          windowIndex,
          'rendition',
          'asset-info-unavailable',
        ));
      }
      for (const result of assetResults) {
        if (result.status === 'failed') {
          failures.push({
            ...preparationFailure(
              asset,
              result.fileRef,
              windowIndex,
              result.stage,
              result.errorCode,
              result.variantId,
            ),
            mediaRole: result.mediaRole,
            componentSemantics: result.componentSemantics,
            originalFilename: result.originalFilename,
          });
          continue;
        }
        discoveredBytes += result.sizeBytes;
        if (result.componentSemantics === 'optional') {
          additionalComponentsBytes += result.sizeBytes;
        } else {
          selectedMediaBytes += result.sizeBytes;
        }
        readyInWindow += 1;
        const variantId = result.variantId || `${sessionRef}-${result.fileRef}`;
        files.push({
          asset,
          variantId,
          mediaRole: result.mediaRole || 'unknown',
          componentSemantics: result.componentSemantics,
          originalFilename: result.originalFilename || result.transferFilename,
          fileRef: result.fileRef,
          windowIndex,
          nativeUri: result.localUri,
          size: result.sizeBytes,
          computedHash: '',
          transferFilename: result.transferFilename,
          filenameSource: 'apple-resource',
          temporary: result.temporary,
          contentType: result.contentType,
          materializationPath: result.materializationPath,
          materializationDurationMs: result.materializationDurationMs,
          temporaryBytesWritten: result.temporaryBytesWritten,
        });
      }
    }
    const finalAsset = assets.at(-1);
    if (finalAsset) {
      onGlobalProgress({
        bytesSent: 0,
        totalBytes: 0,
        acknowledgedMediaBytes: 0,
        plannedUploadMediaBytes: 0,
        rateSampledAt: 0,
        currentMediaMBps: 0,
        averageMediaMBps: 0,
        peakMediaMBps: 0,
        currentEncodedMBps: 0,
        currentIndex: alreadyPreparedFiles + assets.length,
        currentAsset: finalAsset,
        status: 'preparing',
        preparedFiles: alreadyPreparedFiles + assets.length,
        readyFiles: alreadyReadyFiles + readyInWindow,
        totalFiles: totalSelectedFiles,
        preparationComplete: false,
        discoveredBytes: alreadyDiscoveredBytes + discoveredBytes,
        thermalState: 'nominal',
        thermalControl: 'normal',
      });
    }
    return {
      windowIndex,
      files,
      failures,
      preparationDurationMs: Date.now() - startedAt,
      filenameResolutionDurationMs: Date.now() - startedAt,
      filenameResolutionAppleCount: files.length,
      discoveredBytes,
      selectedMediaBytes,
      additionalComponentsBytes,
      selectedMediaFiles:
        files.filter(file => file.componentSemantics === 'primary').length +
        failures.filter(failure => failure.componentSemantics !== 'optional').length,
      additionalComponentsFiles:
        files.filter(file => file.componentSemantics === 'optional').length +
        failures.filter(failure => failure.componentSemantics === 'optional').length,
    };
  }

  const candidates: (PreparedUploadFile | null)[] = new Array(assets.length).fill(null);
  const failures: PreparationFailure[] = [];
  let metadataCursor = 0;
  let completedInWindow = 0;
  let discoveredBytes = 0;
  let readyInWindow = 0;

  const metadataWorker = async () => {
    while (!isCancelled()) {
      const localIndex = metadataCursor++;
      if (localIndex >= assets.length) return;
      const asset = assets[localIndex];
      const fileRef = startIndex + localIndex + 1;
      const nativeUri = await getNativeFileUri(asset);
      try {
        const info = await FileSystem.getInfoAsync(nativeUri);
        if (!info.exists || info.isDirectory) {
          failures.push(preparationFailure(asset, fileRef, windowIndex, 'metadata', 'file-missing'));
        } else if (info.size <= 0) {
          failures.push(preparationFailure(asset, fileRef, windowIndex, 'metadata', 'file-empty'));
        } else {
          discoveredBytes += info.size;
          candidates[localIndex] = {
            asset,
            variantId: `${sessionRef}-${fileRef}`,
            mediaRole: 'expo-fallback',
            componentSemantics: 'primary',
            originalFilename: asset.filename,
            fileRef,
            windowIndex,
            nativeUri,
            size: info.size,
            computedHash: '',
            transferFilename: asset.filename,
            filenameSource: 'expo-fallback',
            materializationPath: 'expo-direct',
            materializationDurationMs: 0,
            temporaryBytesWritten: 0,
          };
          readyInWindow += 1;
        }
      } catch {
        failures.push(preparationFailure(asset, fileRef, windowIndex, 'metadata', 'file-size-unavailable'));
      }

      completedInWindow += 1;
      onGlobalProgress({
        bytesSent: 0,
        totalBytes: 0,
        acknowledgedMediaBytes: 0,
        plannedUploadMediaBytes: 0,
        rateSampledAt: 0,
        currentMediaMBps: 0,
        averageMediaMBps: 0,
        peakMediaMBps: 0,
        currentEncodedMBps: 0,
        currentIndex: alreadyPreparedFiles + completedInWindow,
        currentAsset: asset,
        status: 'preparing',
        preparedFiles: alreadyPreparedFiles + completedInWindow,
        readyFiles: alreadyReadyFiles + readyInWindow,
        totalFiles: totalSelectedFiles,
        preparationComplete: false,
        discoveredBytes: alreadyDiscoveredBytes + discoveredBytes,
        thermalState: 'nominal',
        thermalControl: 'normal',
      });
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(METADATA_CONCURRENCY, assets.length) },
      () => metadataWorker(),
    ),
  );
  if (isCancelled()) return null;

  const files = candidates.filter((file): file is PreparedUploadFile => file !== null);
  const filenameStartedAt = Date.now();
  let filenameResolutionAppleCount = 0;
  if (files.length > 0 && nativeCapabilities.available) {
    try {
      const resolutions = await nativeCapabilities.resolveAssetFilenames(files.map(file => ({
        assetId: file.asset.id,
        uri: file.nativeUri,
        fallbackFilename: file.asset.filename,
      })));
      if (isCancelled()) return null;
      const byAssetId = new Map(resolutions.map(result => [result.assetId, result]));
      for (let index = files.length - 1; index >= 0; index -= 1) {
        const file = files[index];
        const resolution = byAssetId.get(file.asset.id);
        if (
          !resolution ||
          (resolution.status !== 'resolved' && resolution.status !== undefined) ||
          !resolution.filename ||
          !resolution.source
        ) {
          failures.push(preparationFailure(
            file.asset,
            file.fileRef,
            windowIndex,
            'filename',
            resolution?.errorCode ?? 'filename-resolution-failed',
          ));
          files.splice(index, 1);
          continue;
        }
        file.transferFilename = resolution.filename;
        file.filenameSource = resolution.source;
        if (resolution.source === 'apple-resource') filenameResolutionAppleCount += 1;
      }
    } catch {
      for (const file of files) {
        failures.push(preparationFailure(
          file.asset,
          file.fileRef,
          windowIndex,
          'filename',
          'filename-resolution-failed',
        ));
      }
      files.length = 0;
    }
  }

  return {
    windowIndex,
    files,
    failures,
    preparationDurationMs: Date.now() - startedAt,
    filenameResolutionDurationMs: nativeCapabilities.available
      ? Date.now() - filenameStartedAt
      : 0,
    filenameResolutionAppleCount,
    discoveredBytes,
    selectedMediaBytes: discoveredBytes,
    additionalComponentsBytes: 0,
    selectedMediaFiles: files.length + failures.length,
    additionalComponentsFiles: 0,
  };
}

// Retained as a compatibility helper for focused preparation tests. Production
// transfer code consumes prepareAssetWindow directly and begins uploading after
// the first completed window.
export async function prepareAssetsForUpload({
  assets,
  sessionRef = 'preparation-test',
  isCancelled,
  onGlobalProgress,
  includeAdditionalMediaComponents = false,
}: {
  assets: MediaAsset[];
  sessionRef?: string;
  isCancelled: () => boolean;
  onGlobalProgress: (progress: GlobalProgress) => void;
  includeAdditionalMediaComponents?: boolean;
}): Promise<PreparationResult | null> {
  const startedAt = Date.now();
  const fileInfos: PreparedUploadFile[] = [];
  let filenameResolutionDurationMs = 0;
  let filenameResolutionAppleCount = 0;
  let filenameResolutionBatchCount = 0;
  let filenameResolutionMaxBatchSize = 0;
  let discoveredBytes = 0;
  let selectedMediaBytes = 0;
  let additionalComponentsBytes = 0;
  let selectedMediaFiles = 0;
  let additionalComponentsFiles = 0;

  for (let startIndex = 0; startIndex < assets.length; startIndex += NATIVE_FILENAME_BATCH_SIZE) {
    const windowAssets = assets.slice(startIndex, startIndex + NATIVE_FILENAME_BATCH_SIZE);
    const window = await prepareAssetWindow({
      assets: windowAssets,
      sessionRef,
      startIndex,
      windowIndex: filenameResolutionBatchCount,
      totalSelectedFiles: assets.length,
      alreadyPreparedFiles: startIndex,
      alreadyReadyFiles: fileInfos.length,
      alreadyDiscoveredBytes: discoveredBytes,
      includeAdditionalMediaComponents,
      isCancelled,
      onGlobalProgress,
    });
    if (!window) return null;
    filenameResolutionBatchCount += 1;
    filenameResolutionMaxBatchSize = Math.max(filenameResolutionMaxBatchSize, windowAssets.length);
    filenameResolutionDurationMs += window.filenameResolutionDurationMs;
    filenameResolutionAppleCount += window.filenameResolutionAppleCount;
    discoveredBytes += window.discoveredBytes;
    selectedMediaBytes += window.selectedMediaBytes;
    additionalComponentsBytes += window.additionalComponentsBytes;
    selectedMediaFiles += window.selectedMediaFiles;
    additionalComponentsFiles += window.additionalComponentsFiles;
    fileInfos.push(...window.files);
  }

  return {
    fileInfos,
    preparationDurationMs: Date.now() - startedAt,
    filenameResolutionDurationMs,
    filenameResolutionBatchCount,
    filenameResolutionAppleCount,
    filenameResolutionFallbackCount: fileInfos.length - filenameResolutionAppleCount,
    filenameResolutionMaxBatchSize,
    totalBytesToUpload: discoveredBytes,
    selectedMediaBytes,
    additionalComponentsBytes,
    selectedMediaFiles,
    additionalComponentsFiles,
  };
}
