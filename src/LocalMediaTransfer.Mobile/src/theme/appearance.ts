import type { ThemePalette } from './index';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export type ActionVariant = 'primary' | 'secondary' | 'destructive' | 'plain';
export type InteractionProfile = 'action' | 'row' | 'navigation';
export type InteractionState = { disabled?: boolean; pressed?: boolean };

export function toneAppearance(palette: ThemePalette, tone: Tone) {
  const treatments = {
    neutral: { foreground: palette.onSurfaceVariant, background: palette.surfaceInset },
    info: { foreground: palette.primary, background: palette.primarySoft },
    success: { foreground: palette.success, background: palette.successSoft },
    warning: { foreground: palette.warning, background: palette.warningSoft },
    error: { foreground: palette.error, background: palette.errorSoft },
  };
  return { ...treatments[tone], border: palette.border };
}

// TouchableOpacity consumes activeOpacity; Pressable consumes opacity. Use one
// adapter at a time, so feedback and disabled treatments are never stacked.
export function interactionAppearance(profile: InteractionProfile, { disabled = false, pressed = false }: InteractionState = {}) {
  const activeOpacity = { action: 0.8, row: 0.7, navigation: 0.65 }[profile];
  return {
    activeOpacity: disabled ? 1 : activeOpacity,
    opacity: disabled ? (profile === 'action' ? 1 : 0.5) : pressed ? activeOpacity : 1,
  };
}

export function actionAppearance(palette: ThemePalette, variant: ActionVariant, state: InteractionState = {}) {
  const treatment = variant === 'primary'
    ? { foreground: palette.onPrimary, background: palette.primaryFill, border: palette.primaryFill }
    : variant === 'plain'
      ? { foreground: palette.primary, background: 'transparent', border: 'transparent' }
      : toneAppearance(palette, variant === 'destructive' ? 'error' : 'info');
  const foreground = state.disabled ? palette.onSurfaceVariant : treatment.foreground;
  return {
    foreground,
    container: {
      backgroundColor: state.disabled && variant !== 'plain' ? palette.disabledFill : treatment.background,
      borderColor: state.disabled ? palette.border : treatment.border,
    },
    ...interactionAppearance('action', state),
  };
}

export function tabAppearance(palette: ThemePalette, state: InteractionState & { selected: boolean }) {
  return {
    foreground: state.disabled ? palette.onSurfaceVariant : state.selected ? palette.primary : palette.onSurfaceVariant,
    ...interactionAppearance('navigation', state),
  };
}

export function navigationAppearance(palette: ThemePalette, mode: 'light' | 'dark', reduceTransparency = false) {
  return {
    background: reduceTransparency ? palette.elevatedSurface : palette.navigationOverlay,
    separator: palette.separator,
    tint: mode === 'dark' ? 'systemChromeMaterialDark' as const : 'systemChromeMaterialLight' as const,
  };
}

// A continuous tray keeps unselected segments visible. Disabled wins over
// selected/pressed; pressing never erases the selected fill.
export function segmentAppearance(palette: ThemePalette, state: InteractionState & { selected: boolean }) {
  return {
    foreground: state.disabled ? palette.onSurfaceVariant : state.selected || state.pressed ? palette.primary : palette.onSurfaceVariant,
    backgroundColor: state.disabled ? palette.disabledFill : state.selected || state.pressed ? palette.primarySoft : 'transparent',
    borderColor: state.selected && !state.disabled ? palette.border : 'transparent',
  };
}

export function controlGroupAppearance(palette: ThemePalette) {
  return { backgroundColor: palette.elevatedSurface, borderColor: palette.border };
}

// Photo feedback must contrast with image content in either app appearance.
export function mediaSelectionAppearance(palette: ThemePalette, selected: boolean) {
  return {
    overlay: 'rgba(0,0,0,0.35)',
    border: palette.primary,
    badgeFill: selected ? palette.primaryFill : 'rgba(0,0,0,0.45)',
    badgeBorder: palette.white,
  };
}

export function addressPanelAppearance(palette: ThemePalette) {
  return { backgroundColor: palette.surfaceInset, borderColor: palette.border };
}

export function outlinedActionAppearance(palette: ThemePalette, state: InteractionState = {}) {
  const appearance = actionAppearance(palette, 'secondary', state);
  return { ...appearance, container: { ...appearance.container, borderColor: state.disabled ? palette.border : palette.primary } };
}
