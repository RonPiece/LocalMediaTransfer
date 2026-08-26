export const MEDIA_VARIANT_ROLES = [
  'original-photo',
  'original-video',
  'raw-original',
  'jpeg-companion',
  'live-photo-still',
  'live-photo-motion',
  'edited-photo',
  'edited-video',
  'edited-live-photo-still',
  'expo-fallback',
  'unknown',
] as const;

export type MediaVariantRole = typeof MEDIA_VARIANT_ROLES[number];
export type MediaComponentSemantics = 'primary' | 'optional';
export type MediaMaterializationPath =
  | 'photo-resource'
  | 'video-resource'
  | 'raw-resource'
  | 'live-photo-motion'
  | 'current-image'
  | 'current-video'
  | 'expo-direct';

const ROLE_SET = new Set<string>(MEDIA_VARIANT_ROLES);

export function isMediaVariantRole(value: unknown): value is MediaVariantRole {
  return typeof value === 'string' && ROLE_SET.has(value);
}

export function mediaVariantLabel(role: MediaVariantRole): string {
  switch (role) {
    case 'original-photo': return 'Original photo';
    case 'original-video': return 'Original video';
    case 'raw-original': return 'RAW original';
    case 'jpeg-companion': return 'JPEG companion';
    case 'live-photo-still': return 'Live Photo still';
    case 'live-photo-motion': return 'Live Photo motion';
    case 'edited-photo': return 'Current edited photo';
    case 'edited-video': return 'Current edited video';
    case 'edited-live-photo-still': return 'Current edited Live Photo still';
    case 'expo-fallback': return 'Expo compatibility file';
    default: return 'Media file';
  }
}

export function mediaComponentFailureMessage(
  role: MediaVariantRole,
  semantics: MediaComponentSemantics,
  message: string,
): string {
  const component = mediaVariantLabel(role);
  return semantics === 'optional'
    ? `Optional ${component.toLowerCase()} failed. The main media can still transfer. ${message}`
    : message;
}
