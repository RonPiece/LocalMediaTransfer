import { actionAppearance, interactionAppearance, navigationAppearance, tabAppearance, toneAppearance } from './appearance';
import tokens from './tokens.json';

describe.each([['light', tokens.colors], ['dark', tokens.darkColors]] as const)('%s appearance recipes', (mode, palette) => {
  it.each(['action', 'row', 'navigation'] as const)('gives disabled precedence over pressed for %s', profile => {
    expect(interactionAppearance(profile, { disabled: true, pressed: true }))
      .toEqual(interactionAppearance(profile, { disabled: true, pressed: false }));
    expect(interactionAppearance(profile, { disabled: true }).activeOpacity).toBe(1);
    expect(interactionAppearance(profile, { pressed: true }).opacity).toBeLessThan(1);
  });

  it.each(['primary', 'secondary', 'destructive', 'plain'] as const)('resolves %s disabled foreground and fill centrally', variant => {
    const appearance = actionAppearance(palette, variant, { disabled: true, pressed: true });
    expect(appearance.foreground).toBe(palette.onSurfaceVariant);
    expect(appearance.container.backgroundColor).toBe(variant === 'plain' ? 'transparent' : palette.disabledFill);
    expect(appearance.opacity).toBe(1); // disabled colors are not dimmed a second time
    expect(appearance.activeOpacity).toBe(1);
  });

  it('distinguishes primary, secondary and destructive actions', () => {
    expect(actionAppearance(palette, 'primary').container.backgroundColor).toBe(palette.primaryFill);
    expect(actionAppearance(palette, 'primary').foreground).toBe(palette.onPrimary);
    expect(actionAppearance(palette, 'secondary').container.backgroundColor).toBe(palette.primarySoft);
    expect(actionAppearance(palette, 'secondary').foreground).toBe(palette.primary);
    expect(actionAppearance(palette, 'destructive').foreground).toBe(palette.error);
  });

  it('keeps selection separate from availability', () => {
    expect(tabAppearance(palette, { selected: true }).foreground).toBe(palette.primary);
    expect(tabAppearance(palette, { selected: false }).foreground).toBe(palette.onSurfaceVariant);
    const disabled = tabAppearance(palette, { selected: true, disabled: true, pressed: true });
    expect(disabled.foreground).toBe(palette.onSurfaceVariant);
    expect(disabled.activeOpacity).toBe(1);
    expect(disabled.opacity).toBe(0.5);
  });

  it('uses soft semantic backgrounds without component alpha calculations', () => {
    expect(toneAppearance(palette, 'success')).toEqual({ foreground: palette.success, background: palette.successSoft, border: palette.border });
    expect(toneAppearance(palette, 'neutral').background).toBe(palette.surfaceInset);
  });

  it('provides an opaque navigation fallback for Reduce Transparency', () => {
    expect(navigationAppearance(palette, mode).background).toBe(palette.navigationOverlay);
    expect(navigationAppearance(palette, mode, true).background).toBe(palette.elevatedSurface);
    expect(navigationAppearance(palette, mode).separator).toBe(palette.separator);
    expect(navigationAppearance(palette, mode).tint).toBe(mode === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight');
  });
});

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('dark palette contrast', () => {
  const palette = tokens.darkColors;
  it.each(['background', 'surface', 'elevatedSurface', 'surfaceInset'] as const)('keeps body text readable on %s', surface => {
    expect(contrast(palette.onSurface, palette[surface])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.onSurfaceVariant, palette[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['info', 'success', 'warning', 'error'] as const)('keeps %s text readable on its soft background', tone => {
    const appearance = toneAppearance(palette, tone);
    expect(contrast(appearance.foreground, appearance.background)).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps white text readable on the filled primary action', () => {
    expect(contrast(palette.onPrimary, palette.primaryFill)).toBeGreaterThanOrEqual(4.5);
  });
});

it('preserves existing Light palette values', () => {
  expect(tokens.colors).toMatchObject({
  "primary": "#007AFF",
  "success": "#34C759",
  "error": "#FF3B30",
  "warning": "#FF9500",
  "background": "#F2F2F7",
  "surface": "#FFFFFF",
  "elevatedSurface": "#FFFFFF",
  "onPrimary": "#FFFFFF",
  "onSurface": "#000000",
  "onSurfaceVariant": "rgba(60, 60, 67, 0.6)",
  "border": "rgba(60, 60, 67, 0.12)",
  "separator": "rgba(60, 60, 67, 0.12)",
  "disabledFill": "rgba(60, 60, 67, 0.18)",
  "switchOffTrack": "rgba(120,120,128,0.16)",
  "primarySoft": "#EAF4FF",
  "warningSoft": "#FFF4E5",
  "errorSoft": "#FFEEF0",
  "white": "#FFFFFF",
  "github": "#24292e",
  "inputPlaceholder": "rgba(60, 60, 67, 0.3)",
  "progressTrack": "#E6E9E8",
  "startupErrorBackground": "#FFF7F6",
  "startupErrorTitle": "#9B2119",
  "startupErrorText": "#3B2725"
});
});
