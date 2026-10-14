import React from 'react';
import { LayoutRectangle, Pressable, PressableProps, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, withTiming, type AnimatableValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { actionAppearance, controlGroupAppearance, segmentAppearance, useReduceMotionEnabled, useThemePalette } from '@/theme';

// Shared compact geometry for action groups and segmented selectors. The tray
// and vertical hit slop retain a 44-point touch target around 36-point pills.
export const groupedControlMetrics = { height: 36, radius: 999, padding: 4, gap: 4, fontSize: 12 } as const;

export function ControlGroup({ children }: { children: React.ReactNode }) {
  const palette = useThemePalette();
  return <View style={[styles.tray, controlGroupAppearance(palette)]}>{children}</View>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function controlTransitionConfig(reduceMotion: boolean) {
  'worklet';
  return { duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
}

function transitionValue<T extends AnimatableValue>(value: T, reduceMotion: boolean): T {
  'worklet';
  return reduceMotion ? value : withTiming(value, controlTransitionConfig(false));
}

type ControlAppearance = ReturnType<typeof actionAppearance>;
function AnimatedControl({ appearanceFor, style, children, ...props }: Omit<PressableProps, 'style' | 'children'> & {
  appearanceFor: (pressed: boolean) => ControlAppearance;
  style: StyleProp<ViewStyle>;
  children: (appearance: ControlAppearance, textStyle: ReturnType<typeof useAnimatedStyle>) => React.ReactNode;
}) {
  const disabled = !!props.disabled;
  const [interaction, setInteraction] = React.useState({ pressed: false, disabled });
  // A disabled transition cancels an in-flight press even if Pressability
  // cannot deliver pressOut. Adjust this local state before children render.
  if (interaction.disabled !== disabled) setInteraction({ pressed: false, disabled });
  const reduceMotion = useReduceMotionEnabled();
  const appearance = appearanceFor(interaction.pressed && !disabled && interaction.disabled === disabled);
  const { backgroundColor, borderColor } = appearance.container;
  const { foreground, opacity } = appearance;
  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: transitionValue(backgroundColor, reduceMotion),
    borderColor: transitionValue(borderColor, reduceMotion),
    opacity: transitionValue(opacity, reduceMotion),
  }), [backgroundColor, borderColor, opacity, reduceMotion]);
  const textStyle = useAnimatedStyle(() => ({ color: transitionValue(foreground, reduceMotion) }), [foreground, reduceMotion]);
  return <AnimatedPressable {...props} onPressIn={() => setInteraction({ pressed: true, disabled })} onPressOut={() => setInteraction({ pressed: false, disabled })}
    style={[style, surfaceStyle]}>{children(appearance, textStyle)}</AnimatedPressable>;
}

export function GroupAction({ label, icon, disabled = false, destructive = false, compact = false, busy = false, accessibilityLabel, onPress }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; disabled?: boolean;
  accessibilityLabel?: string; destructive?: boolean; compact?: boolean; busy?: boolean; onPress: () => void;
}) {
  const palette = useThemePalette();
  return <AnimatedControl accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled, ...(busy ? { busy } : {}) }} disabled={disabled} onPress={onPress}
    hitSlop={{ top: 4, bottom: 4 }} style={[styles.action, compact ? styles.iconAction : styles.labeledAction]}
    appearanceFor={pressed => actionAppearance(palette, destructive ? 'destructive' : 'secondary', { disabled, pressed })}>
    {(appearance, textStyle) => <>
      <Ionicons name={icon} size={16} color={appearance.foreground} />
      {!compact && <Animated.Text style={[styles.actionLabel, textStyle]}>{label}</Animated.Text>}
    </>}
  </AnimatedControl>;
}

function Segment<T extends string>({ option, selected, scrollable, hasIndicator, onChange, onLayout }: {
  option: { value: T; label: string; disabled?: boolean }; selected: boolean; scrollable: boolean; hasIndicator: boolean;
  onChange: (value: T) => void; onLayout: NonNullable<PressableProps['onLayout']>;
}) {
  const palette = useThemePalette();
  return <AnimatedControl accessibilityRole="button" accessibilityLabel={option.label}
    accessibilityState={{ selected, disabled: !!option.disabled }} disabled={option.disabled}
    onPress={() => onChange(option.value)} hitSlop={{ top: 4, bottom: 4 }} onLayout={onLayout}
    style={[styles.segment, !scrollable && styles.flexSegment]}
    appearanceFor={pressed => {
      const appearance = segmentAppearance(palette, { selected, disabled: option.disabled, pressed });
      return { foreground: appearance.foreground,
        container: { backgroundColor: hasIndicator && selected && !option.disabled ? 'transparent' : appearance.backgroundColor,
          borderColor: hasIndicator && selected && !option.disabled ? 'transparent' : appearance.borderColor },
        activeOpacity: 1, opacity: 1 };
    }}>
    {(_appearance, textStyle) => <Animated.Text style={[styles.label, textStyle]}>{option.label}</Animated.Text>}
  </AnimatedControl>;
}

function SelectionIndicator({ bounds }: { bounds: LayoutRectangle }) {
  const palette = useThemePalette();
  const reduceMotion = useReduceMotionEnabled();
  const { x, y, width, height } = bounds;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: transitionValue(x, reduceMotion) }, { translateY: transitionValue(y, reduceMotion) }],
    width: transitionValue(width, reduceMotion),
    height: transitionValue(height, reduceMotion),
    backgroundColor: transitionValue(palette.primarySoft, reduceMotion),
    borderColor: transitionValue(palette.border, reduceMotion),
  }), [x, y, width, height, palette.primarySoft, palette.border, reduceMotion]);
  return <Animated.View testID="segment-selection-indicator" pointerEvents="none" accessible={false} style={[styles.indicator, animatedStyle]} />;
}

export function SegmentedControl<T extends string>({ options, value, onChange, scrollable = false, label }: {
  options: readonly { value: T; label: string; disabled?: boolean }[]; value: T;
  onChange: (value: T) => void; scrollable?: boolean; label: string;
}) {
  const palette = useThemePalette();
  const [layouts, setLayouts] = React.useState<Partial<Record<T, LayoutRectangle>>>({});
  const selectedOption = options.find(option => option.value === value);
  const bounds = selectedOption && !selectedOption.disabled ? layouts[value] : undefined;
  // Layout is measured only when native geometry changes, never per animation
  // frame. Put the indicator in the same coordinate space as the segments.
  const segments = options.map(option => <Segment key={option.value} option={option}
    selected={option.value === value} scrollable={scrollable} hasIndicator={!!bounds}
    onChange={onChange} onLayout={({ nativeEvent: { layout } }) => setLayouts(previous => {
      const old = previous[option.value];
      return old && old.x === layout.x && old.y === layout.y && old.width === layout.width && old.height === layout.height
        ? previous : { ...previous, [option.value]: layout };
    })} />);
  const indicator = bounds && <SelectionIndicator bounds={bounds} />;
  return <View accessibilityLabel={label} style={[styles.tray, styles.segmentTray, controlGroupAppearance(palette)]}>
    {scrollable ? <ScrollView horizontal showsHorizontalScrollIndicator
      accessibilityHint="Swipe horizontally to see more options" contentContainerStyle={styles.scrollContent}>{indicator}{segments}</ScrollView> : <>{indicator}{segments}</>}
    {scrollable && <Ionicons name="chevron-forward" size={14} color={palette.onSurfaceVariant} accessible={false} style={styles.scrollHint} />}
  </View>;
}

const styles = StyleSheet.create({
  indicator: { position: 'absolute', top: 0, left: 0, borderRadius: groupedControlMetrics.radius, borderWidth: 1 },
  tray: { flexDirection: 'row', alignItems: 'center', padding: groupedControlMetrics.padding, borderWidth: 1, borderRadius: groupedControlMetrics.radius, gap: groupedControlMetrics.gap },
  segmentTray: { marginBottom: 16 },
  scrollContent: { flexGrow: 1, gap: groupedControlMetrics.gap },
  scrollHint: { marginHorizontal: 2 },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: groupedControlMetrics.height, paddingHorizontal: 8, borderRadius: groupedControlMetrics.radius, borderWidth: 1 },
  iconAction: { width: 44 },
  labeledAction: { width: 104 },
  actionLabel: { fontSize: groupedControlMetrics.fontSize, fontWeight: '600', marginLeft: 4 },
  segment: { minHeight: groupedControlMetrics.height, justifyContent: 'center', alignItems: 'center', borderRadius: groupedControlMetrics.radius, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  flexSegment: { flex: 1, paddingHorizontal: 6 },
  label: { fontSize: groupedControlMetrics.fontSize, fontWeight: '600', textAlign: 'center' },
});
