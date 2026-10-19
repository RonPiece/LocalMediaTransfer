import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useThemePalette } from '@/theme';

export type ProblemThumbnail = { uri: string; mediaType: 'photo' | 'video' };
export type ProblemThumbnails = ReadonlyMap<string, ProblemThumbnail>;

export function ProblemFileThumbnail({ id, name, skipped, thumbnail, onPress }: {
  id: string; name: string; skipped: boolean; thumbnail?: ProblemThumbnail; onPress?: () => void;
}) {
  const palette = useThemePalette();
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  const hasImage = !!thumbnail?.uri && thumbnail.uri !== failedUri;
  const icon = skipped ? 'play-skip-forward-outline' : 'alert-circle-outline';
  const color = skipped ? palette.warning : palette.error;
  return <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={thumbnail?.mediaType === 'video' ? `Video thumbnail ${name}` : `Preview original photo ${name}`}
    accessibilityHint={onPress ? 'Opens this photo inside the app' : 'Original preview is unavailable'}
    accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress}
    style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }}>
    {hasImage ? <Image source={{ uri: thumbnail!.uri }} style={{ width: 56, height: 56 }} contentFit="cover"
      onError={() => setFailedUri(thumbnail!.uri)} cachePolicy="disk" allowDownscaling enforceEarlyResizing recyclingKey={id} />
      : <Ionicons name={icon} size={24} color={color} />}
    {hasImage && thumbnail?.mediaType === 'video' && <View pointerEvents="none" style={{ position: 'absolute', top: 3, left: 3 }}>
      <Ionicons name="play-circle" size={20} color={palette.white} accessible={false} />
    </View>}
    {hasImage && <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, right: 0, padding: 2, borderTopLeftRadius: 6, backgroundColor: palette.surface }}>
      <Ionicons name={icon} size={14} color={color} accessible={false} />
    </View>}
  </TouchableOpacity>;
}
