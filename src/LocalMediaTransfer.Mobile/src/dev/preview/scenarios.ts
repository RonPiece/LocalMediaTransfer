export type PreviewScreen = 'home' | 'connect' | 'media' | 'transfer' | 'history' | 'settings';
export type PreviewScenario = {
  id: string;
  screen: PreviewScreen;
  label: string;
  detail: string;
  progress?: number;
};

export const previewScreens: { id: PreviewScreen; label: string }[] = [
  { id: 'home', label: 'Home' }, { id: 'connect', label: 'Connect' },
  { id: 'media', label: 'Media Picker' }, { id: 'transfer', label: 'Transfers' },
  { id: 'history', label: 'History' }, { id: 'settings', label: 'Settings' },
];

const group = (screen: PreviewScreen, entries: [string, string, string, number?][]): PreviewScenario[] =>
  entries.map(([id, label, detail, progress]) => ({ id: `${screen}-${id}`, screen, label, detail, progress }));

export const previewScenarios: PreviewScenario[] = [
  ...group('home', [
    ['connected', 'Connected with history', 'Secure receiver and recent transfers'],
    ['offline', 'Disconnected', 'First launch without a receiver'],
    ['loading', 'Loading history', 'Hold the initial loading state'],
    ['empty', 'Empty history', 'Connected, with no previous transfers'],
    ['error', 'History unavailable', 'First-load error and Retry'],
    ['refresh-error', 'History refresh failed', 'Saved rows with a quiet warning'],
    ['retrying', 'Connection interrupted', 'Retrying a previously connected receiver'],
    ['details', 'Connection security dialog', 'Open the real security details view'],
  ]),
  ...group('connect', [
    ['offline', 'Ready to connect', 'Discovery off, no saved receiver'],
    ['searching', 'Searching nearby', 'Hold discovery loading'],
    ['found', 'Nearby receivers', 'Sample receiver cards'],
    ['error', 'Discovery failed', 'Retryable discovery error'],
    ['pairing', 'Waiting for approval', 'Windows approval banner'],
    ['trusted', 'Trusted receiver', 'Remembered sample receiver'],
    ['connected', 'Already connected', 'Open active receiver details; other receivers remain unavailable'],
    ['manual', 'Manual connection form', 'Address, fingerprint, and token validation'],
    ['qr', 'QR scanner layout', 'Sample camera background; no camera access'],
  ]),
  ...group('media', [
    ['selected', 'Photos and videos', 'Tap and Select All with generated thumbnails'],
    ['large', 'Large selection', '320 sample items and the large-selection disclosure'],
    ['albums', 'Album picker', 'Open the real album dialog'],
    ['loading', 'Loading media', 'Hold the loading state'],
    ['empty', 'Empty album', 'An album with no media'],
    ['error', 'Photos unavailable', 'Retryable media error'],
    ['pagination-error', 'Loading more failed', 'Grid preserved with pagination retry'],
  ]),
  ...group('transfer', [
    ['idle', 'No active transfer', 'The Transfers tab before choosing media'],
    ['preparing', 'Preparing media', 'Analysis before any upload starts', 35],
    ['checking', 'Checking duplicates', 'Content verification in preparation', 55],
    ['streaming', 'Transferring while preparing', 'Both progress rows active', 55],
    ['catching-up', 'Catching up', 'Prepared files waiting for upload capacity', 65],
    ['uploading', 'Transferring', 'Preparation complete and remaining time visible', 65],
    ['completed', 'Completed', 'Successful results and completion motion', 100],
    ['mixed', 'Completed with errors', 'Successful, duplicate, and failed files', 100],
    ['duplicates', 'All duplicates', 'Every file skipped with avoided bytes', 100],
    ['fatal', 'Transfer failed', 'Failure summary and actionable file errors', 100],
    ['cancelled', 'Cancelled', 'Partially completed session', 100],
    ['results', 'All file results', 'Open the real results sheet', 100],
    ['errors', 'Failed file results', 'Open the errors-only results sheet', 100],
  ]),
  ...group('history', [
    ['populated', 'Transfer history', 'Success, mixed, duplicate, and cancelled sessions'],
    ['empty', 'Empty history', 'No sessions yet'],
    ['loading', 'Loading history', 'Hold the initial loading state'],
    ['error', 'History unavailable', 'First-load failure'],
    ['refresh-error', 'Refresh failed', 'Keep existing rows visible'],
    ['offline', 'Disconnected', 'Reconnect before loading history'],
    ['details', 'Transfer details', 'Open a sample session directly'],
    ['problems', 'Problem files', 'Skipped and failed file details'],
  ]),
  ...group('settings', [
    ['connected', 'Connected settings', 'Interactive preferences held only in preview memory'],
    ['offline', 'Disconnected settings', 'Security and receiver states while offline'],
  ]),
];

export const defaultPreviewScenario = previewScenarios.find(item => item.id === 'transfer-streaming')!;

export function previewScenariosForPlatform(platform: string): PreviewScenario[] {
  const iosOnly = new Set(['media-albums', 'media-loading', 'media-error', 'media-pagination-error']);
  return platform === 'android' ? previewScenarios.filter(item => !iosOnly.has(item.id)) : previewScenarios;
}

export function playbackStage(progress: number): string {
  if (progress < 20) return 'transfer-preparing';
  if (progress < 30) return 'transfer-checking';
  if (progress < 70) return 'transfer-streaming';
  return progress < 100 ? 'transfer-uploading' : 'transfer-completed';
}

export function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}
