import { sampleHistory, sampleMedia, transferFixture } from './fixtures';
import { clampProgress, playbackStage, previewScenarios, previewScenariosForPlatform, previewScreens } from './scenarios';

describe('UI Preview scenarios', () => {
  it('covers every screen and has unique, repeatable scenario identifiers', () => {
    expect(new Set(previewScenarios.map(item => item.id)).size).toBe(previewScenarios.length);
    for (const screen of previewScreens) expect(previewScenarios.some(item => item.screen === screen.id)).toBe(true);
    expect(sampleMedia).toHaveLength(320);
    expect(sampleMedia.every(item => item.uri.startsWith('data:image/png;base64,'))).toBe(true);
    expect(sampleHistory.every(item => !item.sessionId)).toBe(true);
  });

  it('keeps iOS-only album and PhotoKit loading states out of the Android catalog', () => {
    expect(previewScenariosForPlatform('ios').some(item => item.id === 'media-albums')).toBe(true);
    const android = previewScenariosForPlatform('android');
    expect(android.some(item => item.id === 'media-albums')).toBe(false);
    expect(android.filter(item => item.screen === 'media').map(item => item.id)).toEqual(['media-selected', 'media-large', 'media-empty']);
  });

  it.each(['completed', 'mixed', 'duplicates', 'fatal', 'cancelled'])('keeps %s file counts and byte totals consistent', state => {
    const fixture = transferFixture(`transfer-${state}`, 100);
    const summary = fixture.completionSummary!;
    expect(fixture.summary.success + fixture.summary.skipped + fixture.summary.failed).toBe(fixture.resultList.length);
    expect(summary.uploadedFiles).toBe(fixture.resultList.filter(item => item.status === 'success').length);
    expect(summary.skippedFiles).toBe(fixture.resultList.filter(item => item.status === 'skipped').length);
    expect(summary.failedFiles).toBe(fixture.resultList.filter(item => item.status === 'error').length);
    expect(summary.uploadedBytes + summary.avoidedBytes).toBeLessThanOrEqual(summary.selectedBytes);
    if (!summary.uploadedFiles) expect(fixture.peakMediaMBps).toBe(0);
  });

  it('keeps prep, streaming, queue-wait, and upload states distinct', () => {
    expect(transferFixture('transfer-preparing', 30)).toMatchObject({ hasUploadStarted: false, preparationComplete: false });
    expect(transferFixture('transfer-streaming', 60)).toMatchObject({ hasUploadStarted: true, preparationComplete: false, automaticallyStreamsLargeSelection: true });
    expect(transferFixture('transfer-catching-up', 60)).toMatchObject({ queueCatchUpVisible: true, phase: 'waiting' });
    expect(transferFixture('transfer-uploading', 60)).toMatchObject({ preparationComplete: true, queueCatchUpVisible: false });
  });

  it('plays a deterministic lifecycle and bounds scrubbed values', () => {
    expect([0, 20, 30, 70, 100].map(playbackStage)).toEqual([
      'transfer-preparing', 'transfer-checking', 'transfer-streaming', 'transfer-uploading', 'transfer-completed',
    ]);
    expect([-10, 55.7, 120, NaN].map(clampProgress)).toEqual([0, 56, 100, 0]);
  });
});
