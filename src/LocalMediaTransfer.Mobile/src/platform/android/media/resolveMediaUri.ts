import type { SelectedMedia } from '@/services/media/SelectedMedia';

export async function resolveMediaUri(asset: SelectedMedia): Promise<string> {
  return asset.uri;
}
