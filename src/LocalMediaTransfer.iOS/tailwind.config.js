const tokens = require('./src/theme/tokens.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
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
