import React from 'react';
import { AppState, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppearancePreference, segmentAppearance, useAppearancePreference, useThemeMode, useThemePalette } from '@/theme';
import { applyAppearancePreference, ThemePreferenceContext } from '@/theme/ThemeProvider';
import { PreviewAction, PreviewControls, PreviewHandle } from './PreviewControls';
import { PreviewScene } from './PreviewScene';
import { clampProgress, playbackStage, PreviewScenario, PreviewScreen, previewScenarios, previewScenariosForPlatform, previewScreens } from './scenarios';

function PreviewAppearance({ children }: { children: React.ReactNode }) {
  const parent = useAppearancePreference();
  const [original] = React.useState(parent.preference);
  const [preference, setPreference] = React.useState<AppearancePreference>(original);
  React.useLayoutEffect(() => { applyAppearancePreference(preference); }, [preference]);
  React.useEffect(() => () => applyAppearancePreference(original), [original]);
  return <ThemePreferenceContext.Provider value={{ preference, setPreference }}>{children}</ThemePreferenceContext.Provider>;
}

class PreviewErrorBoundary extends React.Component<{ children: React.ReactNode; onCatalog: () => void; onExit: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <SafeAreaView className="flex-1 bg-background dark:bg-background-dark p-6 justify-center">
      <Text className="text-[22px] font-bold text-on-surface dark:text-on-surface-dark">This preview could not render</Text>
      <Text className="text-[15px] text-on-surface-variant dark:text-on-surface-variant-dark my-4">Return to the catalog to choose another scenario.</Text>
      <PreviewAction title="Choose another scenario" onPress={this.props.onCatalog} />
      <PreviewAction title="Exit UI Preview" onPress={this.props.onExit} />
    </SafeAreaView> : this.props.children;
  }
}

const screenIcons: Record<PreviewScreen, React.ComponentProps<typeof Ionicons>['name']> = {
  home: 'home-outline', connect: 'desktop-outline', media: 'images-outline', transfer: 'cloud-upload-outline',
  history: 'time-outline', settings: 'settings-outline',
};
function scenarioIcon(scenario: PreviewScenario): React.ComponentProps<typeof Ionicons>['name'] {
  if (/error|fatal|unavailable/.test(scenario.id)) return 'alert-circle-outline';
  if (/loading|searching|checking/.test(scenario.id)) return 'hourglass-outline';
  if (/empty|idle|offline/.test(scenario.id)) return 'ellipse-outline';
  if (/completed/.test(scenario.id)) return 'checkmark-circle-outline';
  if (/duplicates/.test(scenario.id)) return 'play-skip-forward-outline';
  if (/cancelled/.test(scenario.id)) return 'close-circle-outline';
  return screenIcons[scenario.screen];
}
function PreviewCatalog({ onSelect, onExit, lastScenario, readPosition, savePosition }: {
  onSelect: (scenario: PreviewScenario) => void; onExit: () => void; lastScenario: PreviewScenario | null;
  readPosition: (screen: PreviewScreen) => number; savePosition: (screen: PreviewScreen, offset: number) => void;
}) {
  const [screen, setScreen] = React.useState<PreviewScreen>(lastScenario?.screen ?? 'transfer');
  const palette = useThemePalette();
  const scroll = React.useRef<ScrollView>(null);
  const restored = React.useRef(false);
  const restorePosition = () => {
    if (restored.current) return;
    restored.current = true;
    scroll.current?.scrollTo({ y: readPosition(screen), animated: false });
  };
  return <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
    <ScrollView key={screen} testID="preview-catalog-scroll" ref={scroll} onContentSizeChange={restorePosition} scrollEventThrottle={100}
      onScroll={event => { if (restored.current) savePosition(screen, event.nativeEvent.contentOffset.y); }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text accessibilityRole="header" className="text-[28px] font-bold text-on-surface dark:text-on-surface-dark">UI Preview</Text>
      <Text className="text-[15px] leading-6 text-on-surface-variant dark:text-on-surface-variant-dark mt-2 mb-4">TEST developer workspace. Open any screen with repeatable sample data. No receiver, Photos access, or upload is needed.</Text>
      <PreviewAction title="Exit to normal TEST app" onPress={onExit} icon="exit-outline" />
      <View accessibilityRole="tablist" className="flex-row flex-wrap mt-4 mb-4">
        {previewScreens.map(item => <TouchableOpacity key={item.id} accessibilityRole="tab" accessibilityState={{ selected: screen === item.id }}
          onPress={() => { if (screen !== item.id) { restored.current = false; setScreen(item.id); } }} className="min-h-[48px] flex-row items-center justify-center rounded-xl px-4 py-3 mr-2 mb-2 border"
          style={{ backgroundColor: screen === item.id ? palette.primaryFill : palette.surface, borderColor: palette.primary }}>
          <Ionicons name={screenIcons[item.id]} size={18} color={segmentAppearance(palette, { selected: screen === item.id }).foreground} accessible={false} style={{ marginRight: 8 }} />
          <Text style={{ color: segmentAppearance(palette, { selected: screen === item.id }).foreground }} className="text-[15px] font-semibold">{item.label}</Text>
        </TouchableOpacity>)}
      </View>
      <Text accessibilityRole="header" className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark mb-3">Choose a state</Text>
      {previewScenariosForPlatform(Platform.OS).filter(item => item.screen === screen).map(item => {
        const lastViewed = item.id === lastScenario?.id;
        return <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityState={{ selected: lastViewed }}
          accessibilityLabel={`Preview ${item.label}`} accessibilityHint={lastViewed ? 'Last viewed scenario' : undefined} onPress={() => onSelect(item)}
          className="min-h-[72px] p-4 mb-3 rounded-2xl border flex-row items-start"
          style={{ backgroundColor: palette.surface, borderColor: lastViewed ? palette.primary : palette.border, borderWidth: lastViewed ? 2 : 1 }}>
          <Ionicons name={scenarioIcon(item)} size={22} color={palette.primary} accessible={false} style={{ marginRight: 12, marginTop: 2 }} />
          <View className="flex-1 min-w-0">
            <Text className="text-[17px] font-semibold text-on-surface dark:text-on-surface-dark">{item.label}</Text>
            <Text className="text-[14px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{item.detail}</Text>
            {lastViewed && <View className="flex-row items-center mt-2">
              <Ionicons name="checkmark-circle" size={16} color={palette.primary} accessible={false} />
              <Text style={{ color: palette.primary, marginLeft: 6, fontSize: 13, fontWeight: '600' }}>Last viewed</Text>
            </View>}
          </View>
        </TouchableOpacity>;
      })}
    </ScrollView>
  </SafeAreaView>;
}

function Workspace({ onExit }: { onExit: () => void }) {
  const theme = useThemeMode();
  const positions = React.useRef<Partial<Record<PreviewScreen, number>>>({});
  const readPosition = React.useCallback((screen: PreviewScreen) => positions.current[screen] ?? 0, []);
  const savePosition = React.useCallback((screen: PreviewScreen, offset: number) => { positions.current[screen] = offset; }, []);
  const [lastScenario, setLastScenario] = React.useState<PreviewScenario | null>(null);
  const [scenario, setScenario] = React.useState<PreviewScenario | null>(null);
  const [progress, setProgress] = React.useState(55);
  const [playRequested, setPlaying] = React.useState(false);
  const playing = playRequested && progress < 100;
  const [timeline, setTimeline] = React.useState(false);
  const [controls, setControls] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [revision, resetView] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setProgress(value => clampProgress(value + 2)), 500);
    return () => clearInterval(timer);
  }, [playing]);
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') setPlaying(false); });
    return () => subscription.remove();
  }, []);
  React.useEffect(() => {
    if (!hidden) return;
    const timer = setTimeout(() => setHidden(false), 10_000);
    return () => clearTimeout(timer);
  }, [hidden]);
  const choose = React.useCallback((next: PreviewScenario) => {
    setLastScenario(next); setScenario(next); setProgress(next.progress ?? 55); setPlaying(false); setTimeline(false);
    setControls(false); setHidden(false); resetView();
  }, []);
  const catalog = () => { setScenario(null); setControls(false); setPlaying(false); setHidden(false); };
  const go = (screen: PreviewScreen, state?: string) => {
    const available = previewScenariosForPlatform(Platform.OS);
    choose(available.find(item => item.id === `${screen}-${state}`) ?? available.find(item => item.screen === screen)!);
  };
  const effectiveId = timeline ? playbackStage(progress) : progress >= 100 && playing ? 'transfer-completed' : scenario?.id;
  // Completion stays visible after the playback timer stops.
  const transferId = timeline ? playbackStage(progress) : scenario?.screen === 'transfer' && progress >= 100 && !scenario.id.match(/completed|mixed|duplicates|fatal|cancelled|results|errors|idle/)
    ? 'transfer-completed' : effectiveId;
  const terminal = !!transferId?.match(/completed|mixed|duplicates|fatal|cancelled|results|errors|idle/);
  const title = previewScenarios.find(item => item.id === transferId)?.label ?? scenario?.label ?? '';
  return <>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    {!scenario ? <PreviewCatalog onSelect={choose} onExit={onExit} lastScenario={lastScenario} readPosition={readPosition} savePosition={savePosition} /> : <>
      <PreviewErrorBoundary key={`${scenario.id}:${revision}`} onCatalog={catalog} onExit={onExit}>
        <PreviewScene scenario={scenario} transferId={transferId} progress={progress} go={go} onCatalog={catalog} />
      </PreviewErrorBoundary>
      {!hidden && <PreviewHandle onPress={() => setControls(true)} />}
      <PreviewControls visible={controls} title={title} progress={progress} playing={playing}
        transfer={scenario.screen === 'transfer' && scenario.id !== 'transfer-idle'} canPlay={!terminal}
        onProgress={value => { setPlaying(false); setProgress(value); }} onPlay={() => setPlaying(value => !value)}
        onReplay={() => { choose(previewScenarios.find(item => item.id === 'transfer-preparing')!); setProgress(0); setTimeline(true); setPlaying(true); }}
        onReset={() => choose(scenario)} onCatalog={catalog}
        onHide={() => { setPlaying(false); setControls(false); setHidden(true); }} onExit={onExit} onClose={() => setControls(false)} />
    </>}
  </>;
}

export function PreviewHost({ onExit }: { onExit: () => void }) {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><PreviewAppearance>
    <Workspace onExit={onExit} />
  </PreviewAppearance></SafeAreaProvider></GestureHandlerRootView>;
}
