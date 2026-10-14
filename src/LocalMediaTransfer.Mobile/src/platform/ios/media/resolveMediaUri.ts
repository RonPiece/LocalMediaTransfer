import * as MediaLibrary from 'expo-media-library/legacy';

import type { SelectedMedia } from '@/services/media/SelectedMedia';

export async function resolveMediaUri(asset: SelectedMedia): Promise<string> {
  try {
    const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
    if (assetInfo?.localUri) return assetInfo.localUri;
  } catch {
    // The picker URI can still be a valid current rendition. File-system
    // validation in the shared preparation path decides whether it can proceed.
  }
  return asset.uri;
}
