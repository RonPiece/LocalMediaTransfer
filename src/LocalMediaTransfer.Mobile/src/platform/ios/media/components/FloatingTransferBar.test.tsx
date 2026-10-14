import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
  FloatingTransferBar,
  largeTransferGuidance,
} from './FloatingTransferBar';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });

describe('FloatingTransferBar large-transfer guidance', () => {
  it('always provides information without showing the inline warning below 2,000 items', () => {
    const view = render(
      <FloatingTransferBar selectedCount={1999} onTransfer={jest.fn()} />,
    );
    expect(view.getByLabelText('Large transfer information')).toBeTruthy();
    expect(view.queryByText(largeTransferGuidance)).toBeNull();

    fireEvent.press(view.getByLabelText('Large transfer information'));
    expect(view.getByText(largeTransferGuidance)).toBeTruthy();
  });

  it('shows non-blocking guidance for selections of 2,000 items or more', () => {
    const view = render(
      <FloatingTransferBar selectedCount={2000} onTransfer={jest.fn()} />,
    );
    expect(view.getByText(largeTransferGuidance)).toBeTruthy();
    expect(view.getByText('Transfer 2,000 Files')).toBeTruthy();
    expect(largeTransferGuidance).not.toMatch(/slow down|pause/i);
  });
});
