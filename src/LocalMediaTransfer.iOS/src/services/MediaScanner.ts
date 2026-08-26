import * as MediaLibrary from 'expo-media-library';

export interface MediaAsset {
  id: string;
  uri: string;
  type: 'photo' | 'video';
  duration?: number; // seconds
  modificationTime: number;
  width: number;
  height: number;
  filename: string;
}

export type MediaPage = {
  assets: MediaAsset[];
  hasNextPage: boolean;
  endCursor?: string;
};

export class MediaScanner {
  public async ensurePermission(): Promise<boolean> {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  }

  public async getAlbums(): Promise<MediaLibrary.Album[]> {
    if (!(await this.ensurePermission())) return [];
    return await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
  }

  private toMediaAsset(asset: MediaLibrary.Asset): MediaAsset {
    return {
      id: asset.id,
      uri: asset.uri,
      type: asset.mediaType === 'video' ? 'video' : 'photo',
      duration: asset.duration,
      modificationTime: asset.modificationTime,
      width: asset.width,
      height: asset.height,
      filename: asset.filename,
    };
  }

  public async getMediaPage(limit: number = 100, albumId?: string, after?: string): Promise<MediaPage> {
    if (!(await this.ensurePermission())) {
      return { assets: [], hasNextPage: false };
    }

    const result = await MediaLibrary.getAssetsAsync({
      first: limit,
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      album: albumId
    });

    return {
      assets: result.assets.map(asset => this.toMediaAsset(asset)),
      hasNextPage: result.hasNextPage,
      endCursor: result.endCursor,
    };
  }

  public async forEachMediaPage(
    albumId: string | undefined,
    onPage: (assets: MediaAsset[]) => void | Promise<void>,
    pageSize: number = 500,
  ): Promise<void> {
    if (!(await this.ensurePermission())) return;

    let hasNextPage = true;
    let after: string | undefined = undefined;

    while (hasNextPage) {
      const page = await this.getMediaPage(pageSize, albumId, after);
      await onPage(page.assets);
      hasNextPage = page.hasNextPage;
      after = page.endCursor;
    }
  }

  public async getMediaByIds(ids: Set<string>, albumId?: string): Promise<MediaAsset[]> {
    const selected: MediaAsset[] = [];
    await this.forEachMediaPage(albumId, (assets) => {
      assets.forEach(asset => {
        if (ids.has(asset.id)) selected.push(asset);
      });
    });
    return selected;
  }

  public async getAllMedia(albumId?: string): Promise<MediaAsset[]> {
    if (!(await this.ensurePermission())) return [];

    let allAssets: MediaLibrary.Asset[] = [];
    let hasNextPage = true;
    let after: string | undefined = undefined;

    while (hasNextPage) {
      const result = await MediaLibrary.getAssetsAsync({
        first: 500, // fetch in chunks of 500
        after,
        sortBy: [MediaLibrary.SortBy.creationTime],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        album: albumId
      });

      for (const asset of result.assets) {
        allAssets.push(asset);
      }
      hasNextPage = result.hasNextPage;
      after = result.endCursor;
    }

    return allAssets.map(asset => this.toMediaAsset(asset));
  }

  public formatDuration(seconds?: number): string | undefined {
    if (!seconds) return undefined;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

export const mediaScanner = new MediaScanner();
