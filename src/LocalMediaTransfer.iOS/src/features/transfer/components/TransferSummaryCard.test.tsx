import React from 'react';
import { render } from '@testing-library/react-native';

import { TransferSummaryCard } from './TransferSummaryCard';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

describe('TransferSummaryCard', () => {
  it('does not label a partial prepared-byte total as the full selection size', () => {
    const screen = render(
      <TransferSummaryCard
        successCount={4}
        skipCount={0}
        errorCount={3}
        processedCount={7}
        selectedBytes={24_000_000}
        selectedMediaBytes={20_000_000}
        additionalComponentsBytes={4_000_000}
        additionalComponentsFiles={2}
        byteTotalComplete={false}
        transferredBytes={24_000_000}
        avoidedBytes={2_000_000}
        finalizationDuplicateBytes={3_000_000}
        elapsedSeconds={60}
        averageMediaMBps={1}
        peakMediaMBps={2}
        resultCount={7}
        onShowAll={jest.fn()}
        onShowErrors={jest.fn()}
      />,
    );

    expect(screen.getByText('Prepared selected media')).toBeTruthy();
    expect(screen.getByText('Additional components (2)')).toBeTruthy();
    expect(screen.getByText('Total transfer content')).toBeTruthy();
    expect(screen.getByText('Size excludes media that could not be prepared.')).toBeTruthy();
    expect(screen.getByText('Avoided before upload')).toBeTruthy();
    expect(screen.getByText('Uploaded, then found duplicate')).toBeTruthy();
    expect(screen.getByText('Stored as new files')).toBeTruthy();
  });
});
