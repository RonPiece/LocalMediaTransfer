const tokens = require('./src/theme/tokens.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Leave darkMode unset: NativeWind 2 supplies its native ::dark variant.
  // Tailwind's browser media variant cannot match iOS/Android appearance.
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: tokens.colors.primary,
        success: tokens.colors.success,
        error: tokens.colors.error,
        warning: tokens.colors.warning,
        background: tokens.colors.background,
        surface: tokens.colors.surface,
        'surface-elevated': tokens.colors.elevatedSurface,
        'on-primary': tokens.colors.onPrimary,
        'on-surface': tokens.colors.onSurface,
        'on-surface-variant': tokens.colors.onSurfaceVariant,
        border: tokens.colors.border,
        'surface-inset': tokens.colors.surfaceInset,
        'surface-inset-dark': tokens.darkColors.surfaceInset,
        'primary-fill': tokens.colors.primaryFill,
        'primary-fill-dark': tokens.darkColors.primaryFill,
        'primary-soft': tokens.colors.primarySoft,
        'primary-soft-dark': tokens.darkColors.primarySoft,
        'success-soft': tokens.colors.successSoft,
        'success-soft-dark': tokens.darkColors.successSoft,
        'warning-soft': tokens.colors.warningSoft,
        'warning-soft-dark': tokens.darkColors.warningSoft,
        'error-soft': tokens.colors.errorSoft,
        'error-soft-dark': tokens.darkColors.errorSoft,
        'separator': tokens.colors.separator,
        'separator-dark': tokens.darkColors.separator,
        'disabled-fill': tokens.colors.disabledFill,
        'disabled-fill-dark': tokens.darkColors.disabledFill,
        'background-dark': tokens.darkColors.background,
        'surface-dark': tokens.darkColors.surface,
        'surface-elevated-dark': tokens.darkColors.elevatedSurface,
        'on-surface-dark': tokens.darkColors.onSurface,
        'on-surface-variant-dark': tokens.darkColors.onSurfaceVariant,
        'border-dark': tokens.darkColors.border,
        'primary-dark': tokens.darkColors.primary,
        'success-dark': tokens.darkColors.success,
        'warning-dark': tokens.darkColors.warning,
        'error-dark': tokens.darkColors.error,
      },
    },
  },
  plugins: [],
}
