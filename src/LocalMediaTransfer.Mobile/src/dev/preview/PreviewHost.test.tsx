import React from 'react';
import { Text, View } from 'react-native';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as previewAppearance from '@/theme/ThemeProvider';
import { mediaScanner } from '@/platform/ios/media/MediaScanner';
import { uploadManager } from '@/services/UploadManager';
import { listDiagnosticReports } from '@/services/diagnostics/DiagnosticStore';
import { UiPreviewEntry } from './UiPreviewContext';
import { TestPreviewWorkspace } from './TestPreviewWorkspace';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined), notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}), { virtual: true });
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    initialWindowMetrics: { insets: { top: 44, bottom: 34, left: 0, right: 0 }, frame: { width: 390, height: 844, x: 0, y: 0 } },
  };
});
jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: () => 'test',
  nativeCapabilities: { available: true, capabilities: { pinnedHttps: true } },
}));
jest.mock('@/services/UploadManager', () => ({ uploadManager: { uploadFilesConcurrent: jest.fn(), cancel: jest.fn() } }));
jest.mock('expo-camera', () => ({ CameraView: jest.fn(() => null), useCameraPermissions: jest.fn() }));
jest.mock('@/services/diagnostics/DiagnosticStore', () => ({ listDiagnosticReports: jest.fn() }));
jest.mock('@/platform/ios/media/MediaScanner', () => ({ mediaScanner: {
  ensurePermission: jest.fn(), getAlbums: jest.fn(), getMediaPage: jest.fn(),
  formatDuration: () => '1:23',
} }));

function NormalApp({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  React.useEffect(() => { onMount(); return onUnmount; }, [onMount, onUnmount]);
  return <View><Text>Normal TEST app</Text><UiPreviewEntry /></View>;
}

function openCatalog() {
  const onMount = jest.fn();
  const onUnmount = jest.fn();
  const screen = render(<TestPreviewWorkspace><NormalApp onMount={onMount} onUnmount={onUnmount} /></TestPreviewWorkspace>);
  fireEvent.press(screen.getByLabelText('Open UI Preview'));
  expect(screen.getByText('UI Preview')).toBeTruthy();
  expect(screen.queryByText('Normal TEST app')).toBeNull();
  expect(onUnmount).toHaveBeenCalledTimes(1);
  return { ...screen, onMount };
}

describe('TEST UI Preview workspace', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not expose an entry outside the TEST workspace', () => {
    const screen = render(<UiPreviewEntry />);
    expect(screen.queryByLabelText('Open UI Preview')).toBeNull();
  });

  it('previews connected receiver details and unavailable alternatives', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByRole('tab', { name: 'Connect' }));
    fireEvent.press(screen.getByLabelText('Preview Already connected'));
    expect(screen.getAllByLabelText('View connection details for Studio Desktop')).toHaveLength(2);
    expect(screen.getByLabelText('Connect to Editing Laptop')).toBeDisabled();
    fireEvent.press(screen.getAllByLabelText('View connection details for Studio Desktop')[0]);
    expect(screen.getByText('Connection details')).toBeTruthy();
    expect(screen.getByText('TLS 1.3')).toBeTruthy();
    expect(within(screen.getByTestId('connection-address-panel')).getByText('https://sample-receiver.invalid:18443')).toBeTruthy();
  });

  it('returns to the last catalog category, position and marked scenario', () => {
    const scrollTo = jest.spyOn(ReactNative.ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined);
    try {
      const screen = openCatalog();
      fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
      fireEvent(screen.getByTestId('preview-catalog-scroll'), 'contentSizeChange', 390, 1800);
      fireEvent.scroll(screen.getByTestId('preview-catalog-scroll'), { nativeEvent: { contentOffset: { x: 0, y: 280 } } });
      fireEvent.press(screen.getByLabelText('Preview Connected with history'));
      fireEvent.press(screen.getByLabelText('Open preview controls'));
      fireEvent.press(screen.getByText('Choose screen / state'));
      expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState.selected).toBe(true);
      expect(screen.getByLabelText('Preview Connected with history').props.accessibilityState.selected).toBe(true);
      expect(screen.getByText('Last viewed')).toBeTruthy();
      fireEvent(screen.getByTestId('preview-catalog-scroll'), 'contentSizeChange', 390, 1800);
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 280, animated: false });
    } finally { scrollTo.mockRestore(); }
  });

  it('unmounts the live app for preview and restores it on exit', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('Exit to normal TEST app'));
    expect(screen.getByText('Normal TEST app')).toBeTruthy();
    expect(screen.onMount).toHaveBeenCalledTimes(2);
  });

  it('renders and scrubs the real transfer view without starting an upload', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByLabelText('Preview Transferring while preparing'));
    expect(screen.getByText('Preparing media')).toBeTruthy();
    expect(screen.getByText('Transferring files')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open preview controls'));
    fireEvent(screen.getByLabelText('Preview transfer progress'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByLabelText('Preview transfer progress').props.accessibilityValue.now).toBe(60);
    fireEvent.press(screen.getByText('Return to preview'));
    expect(uploadManager.uploadFilesConcurrent).not.toHaveBeenCalled();
    expect(uploadManager.cancel).not.toHaveBeenCalled();
  });

  it('shows the picker and selection controls without reading Photos', async () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('Media Picker'));
    fireEvent.press(screen.getByLabelText('Preview Photos and videos'));
    expect(screen.getByText('Media Picker')).toBeTruthy();
    expect(mediaScanner.ensurePermission).not.toHaveBeenCalled();
    expect(mediaScanner.getAlbums).not.toHaveBeenCalled();
    expect(mediaScanner.getMediaPage).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByText('Select All')); });
    expect(uploadManager.uploadFilesConcurrent).not.toHaveBeenCalled();
  });

  it('previews the scanner layout without mounting the camera or permission hook', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('Connect'));
    fireEvent.press(screen.getByLabelText('Preview QR scanner layout'));
    expect(screen.getByText('Sample camera · no camera access')).toBeTruthy();
    expect(CameraView).not.toHaveBeenCalled();
    expect(useCameraPermissions).not.toHaveBeenCalled();
  });

  it('does not load stored diagnostics in preview settings', async () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('Settings'));
    fireEvent.press(screen.getByLabelText('Preview Connected settings'));
    await waitFor(() => expect(screen.getByText('No diagnostic reports are available.')).toBeTruthy());
    expect(listDiagnosticReports).not.toHaveBeenCalled();
  });

  it('holds a first-load history state without accidentally showing populated rows', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('History'));
    fireEvent.press(screen.getByLabelText('Preview Loading history'));
    expect(screen.getByText('Loading history…')).toBeTruthy();
    expect(screen.queryByText('Phone upload')).toBeNull();
  });

  it('recovers a sample history failure in memory when Retry is pressed', () => {
    const screen = openCatalog();
    fireEvent.press(screen.getByText('History'));
    fireEvent.press(screen.getByLabelText('Preview History unavailable'));
    expect(screen.queryByText('Phone upload')).toBeNull();
    fireEvent.press(screen.getByLabelText('Retry loading receiver history'));
    expect(screen.getAllByText('Phone upload').length).toBeGreaterThan(0);
  });

  it('pauses and hides all developer controls for a clean screenshot, then restores them', () => {
    jest.useFakeTimers();
    try {
      const screen = openCatalog();
      fireEvent.press(screen.getByLabelText('Preview Transferring while preparing'));
      fireEvent.press(screen.getByLabelText('Open preview controls'));
      fireEvent.press(screen.getByText('Play from here'));
      fireEvent.press(screen.getByText('Clean screenshot · hide controls for 10 seconds'));
      expect(screen.queryByLabelText('Open preview controls')).toBeNull();
      act(() => { jest.advanceTimersByTime(10_000); });
      expect(screen.getByLabelText('Open preview controls')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Open preview controls'));
      expect(screen.getByLabelText('Preview transfer progress').props.accessibilityValue.now).toBe(55);
      expect(screen.getByText('Play from here')).toBeTruthy();
      screen.unmount();
    } finally { jest.useRealTimers(); }
  });

  it('replays preparation through completion without invoking the uploader', () => {
    jest.useFakeTimers();
    try {
      const screen = openCatalog();
      fireEvent.press(screen.getByLabelText('Preview Preparing media'));
      fireEvent.press(screen.getByLabelText('Open preview controls'));
      fireEvent.press(screen.getByText('Replay full transfer'));
      act(() => { jest.advanceTimersByTime(25_000); });
      expect(screen.getByText('Done')).toBeTruthy();
      expect(uploadManager.uploadFilesConcurrent).not.toHaveBeenCalled();
      expect(uploadManager.cancel).not.toHaveBeenCalled();
      screen.unmount();
    } finally { jest.useRealTimers(); }
  });

  it('restores appearance on exit without persisting preview choices', () => {
    const appearance = jest.spyOn(previewAppearance, 'applyAppearancePreference').mockImplementation(() => undefined);
    try {
      const screen = openCatalog();
      fireEvent.press(screen.getByLabelText('Preview Transferring while preparing'));
      fireEvent.press(screen.getByLabelText('Open preview controls'));
      fireEvent.press(screen.getByText('Dark'));
      expect(appearance).toHaveBeenLastCalledWith('dark');
      fireEvent.press(screen.getByText('Exit to normal TEST app'));
      expect(appearance).toHaveBeenLastCalledWith('system');
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    } finally { appearance.mockRestore(); }
  });
});
