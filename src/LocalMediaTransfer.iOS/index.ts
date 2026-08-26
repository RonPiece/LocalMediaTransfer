import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { theme } from '@/theme';

type StartupBoundaryState = { error: Error | null };

function errorText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n\n${value.stack || ''}`;
  return String(value);
}

function StartupError({ error }: { error: unknown }) {
  return React.createElement(
    ScrollView,
    { contentContainerStyle: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.startupErrorBackground } },
    React.createElement(View, null,
      React.createElement(Text, { style: { color: theme.colors.startupErrorTitle, fontSize: 24, fontWeight: '700', marginBottom: 12 } }, 'Startup failed'),
      React.createElement(Text, { style: { color: theme.colors.startupErrorText, fontSize: 15, lineHeight: 21 } }, errorText(error)),
    ),
  );
}

class StartupBoundary extends React.Component<React.PropsWithChildren, StartupBoundaryState> {
  state: StartupBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StartupBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Initial React render failed', error);
  }

  render() {
    return this.state.error
      ? React.createElement(StartupError, { error: this.state.error })
      : this.props.children;
  }
}

let AppComponent: React.ComponentType;
let moduleLoadError: unknown;
try {
  // Keep this dynamic require so startup module-load failures render the native error boundary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AppComponent = require('./App').default;
} catch (error) {
  moduleLoadError = error;
  AppComponent = function AppLoadFailure() {
    return React.createElement(StartupError, { error });
  };
}

function Root() {
  if (moduleLoadError) return React.createElement(StartupError, { error: moduleLoadError });
  return React.createElement(
    StartupBoundary,
    null,
    React.createElement(AppComponent),
  );
}

registerRootComponent(Root);
