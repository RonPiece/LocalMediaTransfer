import { resolve } from 'node:path';
import { render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { PreviewWorkspace, UiPreviewEntry, useUiPreview } from './production';

const { createPreviewResolver } = require('../../../build-tools/preview-resolver.cjs') as {
  createPreviewResolver: (root: string, environment?: string) => (context: { resolveRequest: jest.Mock }, name: string, platform: string) => { filePath: string };
};

describe('preview build boundary', () => {
  it.each(['ios', 'android'])('excludes preview from production resolution on %s, including by default', platform => {
    const root = resolve(__dirname, '../../..');
    const context = { resolveRequest: jest.fn((_context, filePath) => ({ type: 'sourceFile', filePath })) };
    const resolver = createPreviewResolver(root);
    expect(resolver(context, '@lmt/ui-preview', platform).filePath).toBe(resolve(root, 'src/integrations/uiPreview/production.tsx'));
    expect(() => resolver(context, resolve(root, 'src/dev/preview/fixtures.ts'), platform)).toThrow('Production bundle attempted');
  });
  it.each(['ios', 'android'])('resolves TEST to the separate workspace on %s', platform => {
    const root = resolve(__dirname, '../../..');
    const context = { resolveRequest: jest.fn((_context, filePath) => ({ type: 'sourceFile', filePath })) };
    expect(createPreviewResolver(root, 'test')(context, '@lmt/ui-preview', platform).filePath).toBe(resolve(root, 'src/dev/preview/integration.tsx'));
  });
  it('fails closed on a misspelled environment', () => {
    expect(() => createPreviewResolver('.', 'tesst')).toThrow('must be production or test');
  });
  it('provides a production no-op without developer controls', () => {
    function Probe() { return <Text>{useUiPreview().active ? 'Enabled' : 'Unavailable'}</Text>; }
    const screen = render(<PreviewWorkspace><Text>Real application</Text><UiPreviewEntry /><Probe /></PreviewWorkspace>);
    expect(screen.getByText('Real application')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('Open UI Preview')).toBeNull();
  });
});
