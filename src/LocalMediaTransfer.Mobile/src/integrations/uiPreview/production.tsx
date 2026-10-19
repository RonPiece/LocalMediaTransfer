import type { PreviewIntegration, PreviewWorkspaceProps } from './contract';

// This module must never import the TEST implementation or sample data.
const unavailable: PreviewIntegration = { active: false };
export function useUiPreview(): PreviewIntegration { return unavailable; }
export function UiPreviewEntry() { return null; }
export function PreviewWorkspace({ children }: PreviewWorkspaceProps) { return children; }
