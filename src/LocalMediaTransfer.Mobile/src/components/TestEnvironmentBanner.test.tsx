import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TestEnvironmentBanner } from './TestEnvironmentBanner';

const mockExpectedServerEnvironment = jest.fn<'production' | 'test', []>();

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: () => mockExpectedServerEnvironment(),
  nativeCapabilities: { available: false },
}));

describe('TestEnvironmentBanner', () => {
  beforeEach(() => mockExpectedServerEnvironment.mockReturnValue('test'));

  it('remains visible for Expo Go and other TEST clients', () => {
    render(<TestEnvironmentBanner />);

    expect(screen.getByLabelText('TEST environment')).toBeTruthy();
    expect(screen.getByText('TEST ENVIRONMENT')).toBeTruthy();
  });

  it('is absent from production', () => {
    mockExpectedServerEnvironment.mockReturnValue('production');

    render(<TestEnvironmentBanner />);

    expect(screen.queryByLabelText('TEST environment')).toBeNull();
  });
});
