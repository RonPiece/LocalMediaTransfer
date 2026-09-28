import React from 'react';
import { ActivityIndicator, FlatList, Modal, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { api } from '@/api/ApiClient';
import { loadProblemPreviews, ProblemPreview, subscribeProblemPreviews } from '@/services/history/ProblemPreviewStore';
import AppHeader from '@/components/AppHeader';
import { TransferHistoryFile } from '@/api/types';
import { useThemePalette } from '@/theme';

function formatBytes(value = 0): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

type LoadedPreview = ProblemPreview & { uri: string };
function HistoryProblemFile({ file, preview, onPreview }: { file: TransferHistoryFile; preview?: LoadedPreview; onPreview: (preview: LoadedPreview) => void }) {
  const palette = useThemePalette();
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  const skipped = file.outcome === 'skipped';
  return (
    <View className="flex-row py-3 border-b border-separator dark:border-separator-dark">
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Preview original photo ${file.name}`} accessibilityHint="Opens this photo inside the app"
        accessibilityState={{ disabled: !preview || preview.mediaType !== 'photo' }}
        disabled={!preview || preview.mediaType !== 'photo'} onPress={() => preview && onPreview(preview)}
        className="w-14 h-14 rounded-xl overflow-hidden items-center justify-center bg-surface dark:bg-surface-dark">
        {preview?.uri && preview.uri !== failedUri ? <Image source={{ uri: preview.uri }} style={{ width: 56, height: 56 }} contentFit="cover"
          onError={() => setFailedUri(preview.uri)} cachePolicy="disk" allowDownscaling enforceEarlyResizing recyclingKey={file.id} /> :
          <Ionicons name={skipped ? 'play-skip-forward-outline' : 'alert-circle-outline'} size={24} color={skipped ? palette.warning : palette.error} />}
        {preview?.uri && preview.uri !== failedUri && <View className="absolute bottom-0 right-0 rounded-tl-md bg-surface dark:bg-surface-dark p-0.5">
          <Ionicons name={skipped ? 'play-skip-forward-outline' : 'alert-circle-outline'} size={14} color={skipped ? palette.warning : palette.error} />
        </View>}
      </TouchableOpacity>
      <View className="ml-3 flex-1">
        <Text className="text-[14px] text-on-surface dark:text-on-surface-dark" numberOfLines={2}>
          {skipped
            ? `${file.name} matched ${file.matchedName || file.savedName || 'an existing file'}`
            : file.name}
        </Text>
        <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">
          {skipped
            ? `${formatBytes(file.avoidedBytes)} avoided · ${file.duplicateStage === 'finalization' ? 'verified after upload' : 'found before upload'}`
            : `Failed${file.error ? ` · ${file.error}` : ''}`}
        </Text>
      </View>
    </View>
  );
}

type ProblemModalProps = {
  files: TransferHistoryFile[] | null; totalProblems: number; sessionId?: string; onClose: () => void;
};
export function HistoryProblemDetailsModal(props: ProblemModalProps) {
  // Closing or changing receiver/session unmounts loading and preview state.
  return props.files ? <ProblemFilesModal key={`${api.url}:${props.sessionId}`} {...props} /> : null;
}

function ProblemFilesModal({
  files,
  totalProblems,
  sessionId,
  onClose,
}: ProblemModalProps) {
  const palette = useThemePalette();
  const [previews, setPreviews] = React.useState<Map<string, LoadedPreview>>(new Map());
  const [selected, setSelected] = React.useState<LoadedPreview | null>(null);
  const [original, setOriginal] = React.useState<{ uri?: string; error?: string }>({});
  const scope = api.url;
  const visible = !!files;
  React.useEffect(() => {
    if (!visible || !sessionId) return;
    let active = true;
    let revision = 0;
    const load = () => {
      const request = ++revision;
      void loadProblemPreviews(scope, sessionId).then(value => {
        if (active && request === revision) setPreviews(value);
      }).catch(() => { if (active && request === revision) setPreviews(new Map()); });
    };
    load();
    const unsubscribe = subscribeProblemPreviews(load);
    return () => { active = false; unsubscribe(); };
  }, [scope, sessionId, visible]);
  React.useEffect(() => {
    let active = true;
    if (!selected) return;
    void (async () => {
      try {
        const permission = await MediaLibrary.getPermissionsAsync();
        if (!permission.granted) throw new Error('Photo access is unavailable. Allow access in iPhone Settings to view the original.');
        const asset = await MediaLibrary.getAssetInfoAsync(selected.assetId, { shouldDownloadFromNetwork: true });
        if (active) setOriginal({ uri: asset.localUri || asset.uri });
      } catch {
        if (active) setOriginal({ error: 'The original is unavailable. It may have been deleted, excluded from limited Photos access, or could not be downloaded from iCloud.' });
      }
    })();
    return () => { active = false; };
  }, [selected]);
  if (!files) return null;
  const omitted = Math.max(0, totalProblems - files.length);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background dark:bg-background-dark">
          <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
            <AppHeader title="Problem Files" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <FlatList
            data={files}
            keyExtractor={(file, index) => `${file.id}:${index}`}
            renderItem={({ item }) => <HistoryProblemFile file={item} preview={previews.get(item.id)} onPreview={preview => { setOriginal({}); setSelected(preview); }} />}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
            ListHeaderComponent={<View>
              <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark my-3">Local previews are kept for recent transfers from this iPhone. Tap a photo to view its original.</Text>
              {omitted > 0 ? (
              <View className="my-3 rounded-xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
                <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark">
                  Showing {files.length.toLocaleString()} of {totalProblems.toLocaleString()} problem files. The transfer totals above remain complete.
                </Text>
              </View>
            ) : null}</View>}
          />
          <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
            <View className="flex-1 bg-background dark:bg-background-dark">
              <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
                <AppHeader title="Original Photo" onClose={() => setSelected(null)} closeStyle="back" />
              </SafeAreaView>
              {original.error ? <Text className="text-on-surface-variant dark:text-on-surface-variant-dark p-5">{original.error}</Text> :
                original.uri ? <Image source={{ uri: original.uri }} style={{ flex: 1 }} contentFit="contain" allowDownscaling enforceEarlyResizing
                  onError={() => setOriginal({ error: 'The original photo could not be displayed.' })} /> : <ActivityIndicator color={palette.primary} style={{ flex: 1 }} />}
            </View>
          </Modal>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
