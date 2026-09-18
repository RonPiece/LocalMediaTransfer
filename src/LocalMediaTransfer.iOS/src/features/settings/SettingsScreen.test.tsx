import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsScreen from './SettingsScreen';

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
