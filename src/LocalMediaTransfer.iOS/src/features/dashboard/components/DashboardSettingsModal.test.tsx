import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DashboardSettingsModal } from './DashboardSettingsModal';
import {
  exportAllDiagnosticReports,
  exportDiagnosticReport,
  listDiagnosticReports,
} from '@/services/diagnostics/DiagnosticStore';

jest.mock('@expo/vector-icons', () => {
  const ReactModule = require('react');
  return { Ionicons: () => ReactModule.createElement(ReactModule.Fragment) };
}, { virtual: true });

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, null, children),
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, null, children),
  };
});

jest.mock('@/services/diagnostics/DiagnosticStore', () => ({
  listDiagnosticReports: jest.fn(),
  exportDiagnosticReport: jest.fn(),
  exportAllDiagnosticReports: jest.fn(),
}));

const reports = [
  {
    path: 'file:///documents/lmt-diagnostics/transfer-new.json',
    schemaVersion: 2,
    startedAt: 2,
    completionStatus: 'completed' as const,
    selectedAssets: 528,
    selectedFiles: 528,
    environment: 'production' as const,
  },
  {
    path: 'file:///documents/lmt-diagnostics/transfer-old.json',
    schemaVersion: 2,
    startedAt: 1,
    completionStatus: 'mixed' as const,
    selectedAssets: 12,
    selectedFiles: 12,
    environment: 'test' as const,
  },
];

describe('DashboardSettingsModal diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listDiagnosticReports as jest.Mock).mockResolvedValue(reports);
    (exportDiagnosticReport as jest.Mock).mockResolvedValue(true);
    (exportAllDiagnosticReports as jest.Mock).mockResolvedValue(true);
  });

  it('offers individual exports for recent reports and an export-all action', async () => {
    const screen = render(
      <DashboardSettingsModal
        visible
        settings={{ skipDuplicates: false, includeAdditionalMediaComponents: false }}
        loading={false}
        nativeHttpsAvailable
        nearbyDiscoveryEnabled={false}
        allowInsecureHttp={false}
        onClose={jest.fn()}
        onSaveSettings={jest.fn()}
        onNearbyDiscoveryChange={jest.fn()}
        onAllowInsecureHttpChange={jest.fn()}
        onExplainUnencryptedHttp={jest.fn()}
      />,
    );

    await waitFor(() => expect(listDiagnosticReports).toHaveBeenCalledTimes(1));
    fireEvent.press(await screen.findByLabelText('Export diagnostic transfer 2'));
    expect(exportDiagnosticReport).toHaveBeenCalledWith(reports[1].path);

    fireEvent.press(screen.getByLabelText('Export all transfer diagnostics'));
    expect(exportAllDiagnosticReports).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Skip Exact Duplicates')).toBeTruthy();
    expect(screen.getByText('Include additional media components')).toBeTruthy();
    expect(screen.getByText('Transfer while preparing')).toBeTruthy();
    expect(screen.getByText(
      'Off waits until all selected media is prepared before uploading and may use substantial temporary storage. On uploads prepared groups while the remaining media is prepared.',
    )).toBeTruthy();
  });

  it('shows a load failure separately from an empty history and retries', async () => {
    (listDiagnosticReports as jest.Mock)
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(reports);
    const screen = render(
      <DashboardSettingsModal
        visible
        settings={{ skipDuplicates: false, includeAdditionalMediaComponents: false }}
        loading={false}
        nativeHttpsAvailable
        nearbyDiscoveryEnabled={false}
        allowInsecureHttp={false}
        onClose={jest.fn()}
        onSaveSettings={jest.fn()}
        onNearbyDiscoveryChange={jest.fn()}
        onAllowInsecureHttpChange={jest.fn()}
        onExplainUnencryptedHttp={jest.fn()}
      />,
    );

    expect(await screen.findByText('Transfer diagnostics could not be loaded from this device.')).toBeTruthy();
    expect(screen.queryByText('No transfer diagnostics are available yet.')).toBeNull();
    fireEvent.press(screen.getByLabelText('Retry loading transfer diagnostics'));
    await waitFor(() => expect(listDiagnosticReports).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Export diagnostic transfer 1')).toBeTruthy();
  });
});
