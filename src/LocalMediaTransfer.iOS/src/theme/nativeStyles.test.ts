import { StyleSheet } from 'react-native';

// Exercise the actual NativeWind 2 compiler and runtime. A component test that
// only checks className strings would miss browser-only dark media queries.
const resolveConfig = require('tailwindcss/resolveConfig');
const { nativePlugin } = require('nativewind/dist/tailwind/native');
const { extractStyles } = require('nativewind/dist/postcss/extract-styles');
const { StyleSheetRuntime } = require('nativewind/dist/style-sheet/runtime');
const tailwindConfig = require('../../tailwind.config.js');
const tokens = require('./tokens.json');

const classes = [
  'bg-background dark:bg-background-dark',
  'bg-surface dark:bg-surface-dark text-on-surface dark:text-on-surface-dark',
  'text-on-surface-variant dark:text-on-surface-variant-dark border-border dark:border-border-dark',
  'bg-surface-inset dark:bg-surface-inset-dark',
  'bg-primary-fill dark:bg-primary-fill-dark',
  'bg-success-soft dark:bg-success-soft-dark',
  'bg-separator dark:bg-separator-dark',
  'bg-primary-soft dark:bg-primary-soft-dark',
  'bg-warning-soft dark:bg-warning-soft-dark',
  'bg-error-soft dark:bg-error-soft-dark',
  'bg-surface-elevated dark:bg-surface-elevated-dark',
  'bg-disabled-fill dark:bg-disabled-fill-dark',
];

describe('compiled native appearance styles', () => {
  it('switches surfaces, text, and borders together when system appearance changes', () => {
    const compiled = extractStyles(resolveConfig({
      ...tailwindConfig,
      plugins: [nativePlugin(), ...tailwindConfig.plugins],
      content: [{ raw: classes.join(' '), extension: 'tsx' }],
    }));
    const runtime = new StyleSheetRuntime();
    runtime.setPlatform('ios');
    runtime.setColorScheme('system');
    let appearanceChanged = (_event: { colorScheme: 'light' | 'dark' }) => {};
    runtime.setAppearance({
      addChangeListener: (listener: typeof appearanceChanged) => {
        appearanceChanged = listener;
        return { remove() {} };
      },
    });
    runtime.create(compiled.raw);
    const keys = classes.map(className => runtime.prepare(className));

    try {
      // Also cover switching back without restarting or remounting the app.
      for (const mode of ['light', 'dark', 'light'] as const) {
        appearanceChanged({ colorScheme: mode });
        const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
        const styles = keys.map(key => StyleSheet.flatten(runtime.getSnapshot()[key]));
        expect(styles[0].backgroundColor).toBe(palette.background);
        expect(styles[1].backgroundColor).toBe(palette.surface);
        expect(styles[1].color).toBe(palette.onSurface);
        expect(styles[2].color).toBe(palette.onSurfaceVariant);
        expect(styles[3].backgroundColor).toBe(palette.surfaceInset);
        expect(styles[4].backgroundColor).toBe(palette.primaryFill);
        expect(styles[5].backgroundColor).toBe(palette.successSoft);
        expect(styles[6].backgroundColor).toBe(palette.separator);
        expect(styles[7].backgroundColor).toBe(palette.primarySoft);
        expect(styles[8].backgroundColor).toBe(palette.warningSoft);
        expect(styles[9].backgroundColor).toBe(palette.errorSoft);
        expect(styles[10].backgroundColor).toBe(palette.elevatedSurface);
        expect(styles[11].backgroundColor).toBe(palette.disabledFill);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          expect(styles[2][`border${side}Color`]).toBe(palette.border);
        }
      }
    } finally {
      runtime.destroy();
    }
  });
});
