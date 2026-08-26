const tokens = require('./src/theme/tokens.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
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
        'on-primary': tokens.colors.onPrimary,
        'on-surface': tokens.colors.onSurface,
        'on-surface-variant': tokens.colors.onSurfaceVariant,
        border: tokens.colors.border,
      },
    },
  },
  plugins: [],
}
