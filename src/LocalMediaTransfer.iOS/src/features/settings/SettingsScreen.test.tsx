import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsScreen from './SettingsScreen';
import { exportDiagnosticReport, exportAllDiagnosticReports, listDiagnosticReports } from '@/services/diagnostics/DiagnosticStore';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

jest.mock('@/services/diagnostics/DiagnosticStore', () => ({
  listDiagnosticReports: jest.fn().mockResolvedValue([]),
  exportDiagnosticReport: jest.fn().mockResolvedValue(false),
  exportAllDiagnosticReports: jest.fn().mockResolvedValue(false),
}));

describe('SettingsScreen', () => {
  it('shows only implemented settings and updates the transfer preparation mode', async () => {
    const onPreparationModeChange = jest.fn();
    const screen = render(
      <SettingsScreen
        isConnected={false}
        connectionSecurity={{ mode: 'disconnected', certificateVerified: false }}
        nativeHttpsAvailable
        nearbyDiscoveryEnabled={false}
        allowInsecureHttp={false}
        preparationMode="prepare-first"
        skipExactDuplicates
        includeAdditionalMediaComponents={false}
        onNearbyDiscoveryChange={jest.fn()}
        onAllowInsecureHttpChange={jest.fn()}
        onExplainUnencryptedHttp={jest.fn()}
        onPreparationModeChange={onPreparationModeChange}
        onSkipExactDuplicatesChange={jest.fn()}
        onIncludeAdditionalMediaComponentsChange={jest.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('No diagnostic reports are available.')).toBeTruthy());
    expect(screen.getByText('No Cloud Required')).toBeTruthy();
    expect(screen.getByText('Files transfer directly to your receiver without cloud storage.')).toBeTruthy();
    fireEvent(screen.getByLabelText('Transfer While Preparing'), 'valueChange', true);
    expect(onPreparationModeChange).toHaveBeenCalledWith('streaming');

    for (const unsupported of ['Auto-reconnect to Trusted Receiver', 'Save Transfer History', 'Keep Screen Awake During Transfer', 'Browser Compatibility Mode']) {
      expect(screen.queryByText(unsupported)).toBeNull();
    }
  });
});

const settingsProps = {
 isConnected: false, connectionSecurity: { mode: 'disconnected' as const, certificateVerified: false },
 nativeHttpsAvailable: true, nearbyDiscoveryEnabled: false, allowInsecureHttp: false,
 preparationMode: 'prepare-first' as const, skipExactDuplicates: true, includeAdditionalMediaComponents: false,
 onNearbyDiscoveryChange: jest.fn(), onAllowInsecureHttpChange: jest.fn(), onExplainUnencryptedHttp: jest.fn(),
 onPreparationModeChange: jest.fn(), onSkipExactDuplicatesChange: jest.fn(), onIncludeAdditionalMediaComponentsChange: jest.fn(),
};

it('opens diagnostic exports only from the dedicated share icons', async () => {
 jest.clearAllMocks();
 jest.mocked(listDiagnosticReports).mockResolvedValueOnce([{ path: 'file://fixture-report', schemaVersion: 1, startedAt: 1, completionStatus: 'mixed', selectedAssets: 3, selectedFiles: 3, environment: 'test' }]);
 jest.mocked(exportDiagnosticReport).mockResolvedValue(true);
 jest.mocked(exportAllDiagnosticReports).mockResolvedValue(true);
 const screen = render(<SettingsScreen {...settingsProps} />);
 const share = await screen.findByRole('button', { name: 'Export diagnostic transfer 1' });
 fireEvent.press(screen.getByText('3 assets · mixed'));
 fireEvent.press(screen.getByTestId('diagnostic-report-row-0'));
 fireEvent.press(screen.getByText('Export all available reports'));
 fireEvent.press(screen.getByTestId('diagnostic-export-all-row'));
 expect(exportDiagnosticReport).not.toHaveBeenCalled();
 expect(exportAllDiagnosticReports).not.toHaveBeenCalled();
 expect(share).toHaveStyle({ width: 44, height: 44 });
 fireEvent.press(share);
 expect(exportDiagnosticReport).toHaveBeenCalledWith('file://fixture-report');
 fireEvent.press(screen.getByRole('button', { name: 'Export all transfer diagnostics' }));
 expect(exportAllDiagnosticReports).toHaveBeenCalledTimes(1);
});
it('keeps the export-all icon disabled when reports are empty', async () => {
 jest.clearAllMocks();
 jest.mocked(listDiagnosticReports).mockResolvedValueOnce([]);
 const screen = render(<SettingsScreen {...settingsProps} />);
 await screen.findByText('No diagnostic reports are available.');
 const button = screen.getByRole('button', { name: 'Export all transfer diagnostics' });
 expect(button).toBeDisabled();
 fireEvent.press(button);
 expect(exportAllDiagnosticReports).not.toHaveBeenCalled();
});
