/** A media item chosen by the user for one foreground transfer session. */
export interface SelectedMedia {
  /** Groups chosen items until the transfer controller starts its native session. */
  selectionSessionId?: string;
  /** Stable within the current selection; never interpreted by shared code. */
  id: string;
  /** Opaque PhotoKit asset identifier or Android picker content URI. */
  nativeReference?: string;
  uri: string;
  thumbnailUri?: string;
  type: 'photo' | 'video';
  filename: string;
  duration?: number;
  modificationTime: number;
  width: number;
  height: number;
}
