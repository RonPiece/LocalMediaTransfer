import React from 'react';
import { Alert } from 'react-native';
import { UiPreviewContext } from './UiPreviewContext';
import { PreviewHost } from './PreviewHost';
import { sampleProblemThumbnails } from './fixtures';

const sampleDiagnostics = {
  listReports: async () => [], exportReport: async () => false, exportAll: async () => false,
};
const showSampleProjectLink = () => Alert.alert('UI Preview', 'External links are disabled in preview.');

/** AppShell mounts this workspace only after both identities resolve to TEST. */
export function TestPreviewWorkspace({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState(false);
  const openPreview = React.useCallback(() => setActive(true), []);
  const exitPreview = React.useCallback(() => setActive(false), []);
  const context = React.useMemo(() => ({ active, openPreview: active ? undefined : openPreview,
    receiverAddress: active ? 'https://sample-receiver.invalid:18443' : undefined,
    serverVersion: active ? 'Sample receiver · 2.0.0' : undefined,
    diagnostics: active ? sampleDiagnostics : undefined,
    problemThumbnails: active ? sampleProblemThumbnails : undefined,
    openProjectLink: active ? showSampleProjectLink : undefined }), [active, openPreview]);
  return <UiPreviewContext.Provider value={context}>
    {active ? <PreviewHost onExit={exitPreview} /> : children}
  </UiPreviewContext.Provider>;
}
