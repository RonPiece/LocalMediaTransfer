import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { loadProblemPreviews } from '@/services/history/ProblemPreviewStore';
import { HistoryProblemDetailsModal } from './HistoryProblemDetailsModal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: React.PropsWithChildren) => children, SafeAreaView: ({ children }: React.PropsWithChildren) => children }));
jest.mock('expo-image', () => ({ Image: (props: object) => {
  const React = require('react'); const { View } = require('react-native');
  return React.createElement(View, { ...props, testID: 'preview-image' });
} }));
jest.mock('expo-media-library/legacy', () => ({ getPermissionsAsync: jest.fn(), getAssetInfoAsync: jest.fn() }));
jest.mock('@/services/history/ProblemPreviewStore', () => ({ loadProblemPreviews: jest.fn(), subscribeProblemPreviews: () => () => undefined }));
const preview = { scope: '', sessionId: 'session', fileId: 'variant', assetId: 'local-fixture', mediaType: 'photo' as const, createdAt: 1, uri: 'data:image/jpeg;base64,AQ==' };
const files = [{ id: 'variant', name: 'fixture', size: 100, outcome: 'skipped' as const, avoidedBytes: 100 }];
beforeEach(() => {
  jest.mocked(loadProblemPreviews).mockResolvedValue(new Map([['variant', preview]]));
  jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: true } as MediaLibrary.PermissionResponse);
  jest.mocked(MediaLibrary.getAssetInfoAsync).mockResolvedValue({ localUri: 'file://original-fixture', uri: 'ph://local-fixture' } as MediaLibrary.AssetInfo);
  jest.clearAllMocks();
});
it.each(['skipped', 'failed'] as const)('shows the saved %s thumbnail and resolves the original only after a tap', async outcome => {
  const screen = render(<HistoryProblemDetailsModal files={[{ ...files[0], outcome }]} totalProblems={1} sessionId="session" onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview original photo fixture' })).not.toBeDisabled());
  expect(screen.getByTestId('preview-image').props.source.uri).toBe(preview.uri);
  expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Preview original photo fixture' }));
  await waitFor(() => expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalledWith(preview.assetId, { shouldDownloadFromNetwork: true }));
  expect(screen.getByText('Original Photo')).toBeTruthy();
  await waitFor(() => expect(screen.getAllByTestId('preview-image').some(image => image.props.source.uri === 'file://original-fixture')).toBe(true));
});
it('retains a saved thumbnail when the original is denied or deleted', async () => {
  jest.mocked(MediaLibrary.getPermissionsAsync).mockResolvedValue({ granted: false } as MediaLibrary.PermissionResponse);
  const screen = render(<HistoryProblemDetailsModal files={files} totalProblems={1} sessionId="session" onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview original photo fixture' })).not.toBeDisabled());
  fireEvent.press(screen.getByRole('button', { name: 'Preview original photo fixture' }));
  expect(await screen.findByText(/The original is unavailable/)).toBeTruthy();
  expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
});
it('does not guess a Photos asset for older records with no local mapping', async () => {
  jest.mocked(loadProblemPreviews).mockResolvedValue(new Map());
  const screen = render(<HistoryProblemDetailsModal files={files} totalProblems={1} sessionId="old-session" onClose={jest.fn()} />);
  await act(async () => {});
  const button = screen.getByRole('button', { name: 'Preview original photo fixture' });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
});
it('ignores a late original response after the problem list closes', async () => {
  let resolveOriginal!: (value: MediaLibrary.AssetInfo) => void;
  jest.mocked(MediaLibrary.getAssetInfoAsync).mockImplementationOnce(() => new Promise(resolve => { resolveOriginal = resolve; }));
  const screen = render(<HistoryProblemDetailsModal files={files} totalProblems={1} sessionId="session" onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview original photo fixture' })).not.toBeDisabled());
  fireEvent.press(screen.getByRole('button', { name: 'Preview original photo fixture' }));
  await waitFor(() => expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalled());
  screen.rerender(<HistoryProblemDetailsModal files={null} totalProblems={1} sessionId="session" onClose={jest.fn()} />);
  await act(async () => { resolveOriginal({ localUri: 'file://original-fixture' } as MediaLibrary.AssetInfo); });
  expect(screen.queryByText('Original Photo')).toBeNull();
  screen.rerender(<HistoryProblemDetailsModal files={files} totalProblems={1} sessionId="session" onClose={jest.fn()} />);
  await act(async () => {});
  expect(screen.queryByText('Original Photo')).toBeNull();
});
