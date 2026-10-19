import React from 'react';
import { Animated, Modal, PanResponder, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SegmentedControl } from '@/components/ui';
import { actionAppearance, outlinedActionAppearance, useAppearancePreference, useReduceMotionEnabled, useThemePalette } from '@/theme';
import { clampProgress } from './scenarios';

export function PreviewAction({ title, onPress, disabled = false, primary = false, icon }: { title: string; onPress: () => void; disabled?: boolean; primary?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const palette = useThemePalette();
  const appearance = primary ? actionAppearance(palette, 'primary', { disabled }) : outlinedActionAppearance(palette, { disabled });
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    activeOpacity={appearance.activeOpacity}
    className="min-h-[48px] px-4 py-3 rounded-xl flex-row items-center justify-center my-1"
    style={{ ...appearance.container, ...(!primary && !disabled ? { backgroundColor: palette.surface } : {}), borderWidth: 1.5 }}>
    {icon && <Ionicons name={icon} size={20} color={appearance.foreground} accessible={false} style={{ marginRight: 12 }} />}
    <Text style={{ color: appearance.foreground, flexShrink: 1 }} className="text-[15px] font-semibold">{title}</Text>
  </TouchableOpacity>;
}

export function ProgressScrubber({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const palette = useThemePalette();
  const [width, setWidth] = React.useState(1);
  return <View accessible accessibilityRole="adjustable" accessibilityLabel="Preview transfer progress"
    accessibilityValue={{ min: 0, max: 100, now: value, text: `${value}%` }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={event => onChange(clampProgress(value + (event.nativeEvent.actionName === 'increment' ? 5 : -5)))}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
    onResponderGrant={event => onChange(clampProgress(event.nativeEvent.locationX / width * 100))}
    onResponderMove={event => onChange(clampProgress(event.nativeEvent.locationX / width * 100))}
    style={{ minHeight: 48, justifyContent: 'center', marginVertical: 8 }}>
    <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: palette.border }}>
      <View style={{ height: 6, width: `${value}%`, borderRadius: 3, backgroundColor: palette.primary }} />
    </View>
    <View pointerEvents="none" style={{ position: 'absolute', left: `${value}%`, marginLeft: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.primary }} />
  </View>;
}

function createHandleDrag(position: Animated.ValueXY, bounds: { maxX: number; minY: number; maxY: number }) {
  let origin = { x: bounds.maxX, y: Math.max(bounds.minY, bounds.maxY - 80) };
  const point = (dx: number, dy: number) => ({ x: Math.max(8, Math.min(bounds.maxX, origin.x + dx)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, origin.y + dy)) });
  const responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 8,
    onPanResponderMove: (_event, gesture) => position.setValue(point(gesture.dx, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => { origin = point(gesture.dx, gesture.dy); },
    onPanResponderTerminate: (_event, gesture) => { origin = point(gesture.dx, gesture.dy); },
  });
  return { ...responder, reset: () => position.setValue(origin) };
}

export function PreviewHandle({ onPress }: { onPress: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const palette = useThemePalette();
  const [position] = React.useState(() => new Animated.ValueXY());
  const bounds = React.useMemo(() => ({ maxX: Math.max(8, width - 172), minY: insets.top + 8,
    maxY: Math.max(insets.top + 8, height - insets.bottom - 72) }), [width, height, insets.top, insets.bottom]);
  const responder = React.useMemo(() => createHandleDrag(position, bounds), [bounds, position]);
  React.useEffect(() => { responder.reset(); }, [responder]);
  return <Animated.View {...responder.panHandlers} style={{ position: 'absolute', left: 0, top: 0, transform: position.getTranslateTransform(), zIndex: 20 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open preview controls"
      accessibilityHint="Drag to move this developer control away from the content." onPress={onPress}
      style={{ minHeight: 48, width: 164, paddingHorizontal: 12, borderRadius: 24, flexDirection: 'row', alignItems: 'center',
        backgroundColor: palette.primary, borderWidth: 1, borderColor: palette.onPrimary }}>
      <Ionicons name="options-outline" size={20} color={palette.onPrimary} />
      <Text style={{ color: palette.onPrimary, fontSize: 13, fontWeight: '700', marginLeft: 8, flex: 1 }}>Preview controls</Text>
    </TouchableOpacity>
  </Animated.View>;
}

export function PreviewControls({ visible, title, progress, canPlay, playing, transfer, onProgress, onPlay, onReplay,
  onReset, onCatalog, onHide, onExit, onClose }: {
  visible: boolean; title: string; progress: number; canPlay: boolean; playing: boolean; transfer: boolean;
  onProgress: (value: number) => void; onPlay: () => void; onReplay: () => void; onReset: () => void;
  onCatalog: () => void; onHide: () => void; onExit: () => void; onClose: () => void;
}) {
  const reduceMotion = useReduceMotionEnabled();
  const { preference, setPreference } = useAppearancePreference();
  return <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text accessibilityRole="header" className="text-[24px] font-bold text-on-surface dark:text-on-surface-dark">Preview controls</Text>
        <Text className="text-[15px] text-on-surface-variant dark:text-on-surface-variant-dark mt-2 mb-4">{title} · sample data</Text>
        <PreviewAction title="Return to preview" onPress={onClose} primary icon="arrow-back-outline" />
        <PreviewAction title="Choose screen / state" onPress={onCatalog} icon="grid-outline" />
        {transfer && <>
          <Text className="text-[16px] font-semibold text-on-surface dark:text-on-surface-dark mt-5">Transfer progress · {progress}%</Text>
          {canPlay && <ProgressScrubber value={progress} onChange={onProgress} />}
          <PreviewAction title={playing ? 'Pause' : 'Play from here'} onPress={onPlay} disabled={!canPlay} icon={playing ? 'pause-outline' : 'play-outline'} />
          <PreviewAction title="Replay full transfer" onPress={onReplay} icon="play-back-outline" />
          <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1 mb-3">Replay moves through preparation, duplicate checks, transfer, and completion. Close this sheet to watch.</Text>
        </>}
        <Text className="text-[16px] font-semibold text-on-surface dark:text-on-surface-dark mt-5 mb-3">Appearance</Text>
        <SegmentedControl label="Preview appearance" value={preference} onChange={setPreference}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-3 mb-4">Use iPhone settings to review larger text, VoiceOver, and Reduce Motion. Preview appearance is restored when you exit.</Text>
        <PreviewAction title="Reset this scenario" onPress={onReset} icon="refresh-outline" />
        <PreviewAction title="Clean screenshot · hide controls for 10 seconds" onPress={onHide} icon="camera-outline" />
        <PreviewAction title="Exit to normal TEST app" onPress={onExit} icon="exit-outline" />
      </ScrollView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
