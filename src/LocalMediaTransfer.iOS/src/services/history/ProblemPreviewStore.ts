import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageKey } from '@/config/storageKeys';
import { MediaAsset } from '@/services/MediaScanner';
import { nativeCapabilities } from '@/services/NativeCapabilities';

export const MAX_PROBLEM_PREVIEWS = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const indexKey = () => storageKey('lmt_problem_preview_index');
const imagePrefix = () => `${indexKey()}:image:`;
export type ProblemPreview = {
  scope: string; sessionId: string; fileId: string; assetId: string;
  mediaType: 'photo' | 'video'; createdAt: number; imageKey?: string;
};
export type PreviewRequest = { fileId: string; asset: MediaAsset };
let work: Promise<void> = Promise.resolve();
let pending = 0;
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
export function subscribeProblemPreviews(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify() { listeners.forEach(listener => listener()); }
function ownedKey(key?: string): key is string {
  return !!key && key.startsWith(imagePrefix()) && /^[a-z0-9-]+$/.test(key.slice(imagePrefix().length));
}
async function readIndex(): Promise<ProblemPreview[]> {
  const raw = await AsyncStorage.getItem(indexKey());
  if (!raw) return [];
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter((item): item is ProblemPreview => !!item && typeof item === 'object'
      && typeof item.scope === 'string' && typeof item.sessionId === 'string'
      && typeof item.fileId === 'string' && typeof item.assetId === 'string'
      && (item.mediaType === 'photo' || item.mediaType === 'video')
      && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
      && (!item.imageKey || ownedKey(item.imageKey)));
  } catch { return []; }
}
async function persist(entries: ProblemPreview[]) {
  const kept = entries.filter(item => item.createdAt >= Date.now() - RETENTION_MS).slice(-MAX_PROBLEM_PREVIEWS);
  await AsyncStorage.setItem(indexKey(), JSON.stringify(kept));
  // Remove only keys owned by this store, including leftovers from failed writes.
  const used = new Set(kept.map(item => item.imageKey));
  const unused = (await AsyncStorage.getAllKeys()).filter(key => ownedKey(key) && !used.has(key));
  if (unused.length) await AsyncStorage.multiRemove(unused);
  notify();
}

// Optional history work has a fixed backlog and runs after terminal outcomes.
// No local Photos references or thumbnail bytes are included in the server API.
export function saveProblemPreviews(scope: string, sessionId: string, requests: PreviewRequest[]): Promise<void> {
  if (!scope || !sessionId || requests.length === 0 || pending >= 3) return Promise.resolve();
  const generation = generations.get(scope) ?? 0;
  const selected = requests.slice(0, MAX_PROBLEM_PREVIEWS).map(({ fileId, asset }) => ({ fileId, asset: { id: asset.id, type: asset.type } }));
  pending++;
  work = work.then(async () => {
    if ((generations.get(scope) ?? 0) !== generation) return;
    let entries = (await readIndex()).filter(item => !(item.scope === scope && item.sessionId === sessionId));
    const records: ProblemPreview[] = selected.map(({ fileId, asset }) => ({
      scope, sessionId, fileId, assetId: asset.id, mediaType: asset.type, createdAt: Date.now(),
    }));
    entries = [...entries, ...records].slice(-MAX_PROBLEM_PREVIEWS);
    await persist(entries);
    const uniqueIds = [...new Set(records.map(item => item.assetId))];
    for (let offset = 0; offset < uniqueIds.length; offset += 20) {
      if ((generations.get(scope) ?? 0) !== generation) return;
      const thumbnails = await (nativeCapabilities.historyThumbnails?.(uniqueIds.slice(offset, offset + 20)) ?? Promise.resolve([])).catch(() => []);
      if ((generations.get(scope) ?? 0) !== generation) return;
      for (const thumbnail of thumbnails) {
        const imageKey = `${imagePrefix()}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        await AsyncStorage.setItem(imageKey, `data:image/jpeg;base64,${thumbnail.jpegBase64}`);
        records.filter(item => item.assetId === thumbnail.assetId).forEach(item => { item.imageKey = imageKey; });
      }
      await persist(entries);
    }
  }).catch(() => undefined).finally(() => { pending--; });
  return work;
}

export async function loadProblemPreviews(scope: string, sessionId?: string): Promise<Map<string, ProblemPreview & { uri: string }>> {
  if (!sessionId) return new Map();
  const entries = (await readIndex()).filter(item => item.scope === scope && item.sessionId === sessionId
    && item.createdAt >= Date.now() - RETENTION_MS).slice(-MAX_PROBLEM_PREVIEWS);
  const images = new Map(await AsyncStorage.multiGet(entries.flatMap(item => item.imageKey ? [item.imageKey] : [])));
  return new Map(entries.map(item => {
    const image = item.imageKey ? images.get(item.imageKey) : null;
    // Do not use a ph:// fallback here: expo-image's Photos loader allows
    // iCloud downloads. Missing thumbnails stay placeholders until a tap.
    const uri = image && image.startsWith('data:image/jpeg;base64,') && image.length <= 32_023 ? image : '';
    return [item.fileId, { ...item, uri }];
  }));
}

export function clearProblemPreviews(scope: string): Promise<void> {
  generations.set(scope, (generations.get(scope) ?? 0) + 1);
  const clearing = work.then(async () => { await persist((await readIndex()).filter(item => item.scope !== scope)); });
  work = clearing.catch(() => undefined);
  return clearing;
}

export function pruneProblemPreviews(): Promise<void> {
  const pruning = work.then(async () => { await persist(await readIndex()); });
  work = pruning.catch(() => undefined);
  return pruning;
}
