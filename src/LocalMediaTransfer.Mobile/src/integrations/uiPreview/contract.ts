import type { ReactNode } from 'react';
import type { DiagnosticReportSummary } from '@/services/diagnostics/DiagnosticTypes';
import type { ProblemThumbnails } from '@/features/history/components/ProblemFileThumbnail';

/** The small port shared screens may use; implementations are selected by Metro. */
export type PreviewIntegration = {
  active: boolean;
  openPreview?: () => void;
  receiverAddress?: string;
  serverVersion?: string;
  problemThumbnails?: ProblemThumbnails;
  openProjectLink?: () => void;
  diagnostics?: {
    listReports: () => Promise<DiagnosticReportSummary[]>;
    exportReport: (path: string) => Promise<boolean>;
    exportAll: () => Promise<boolean>;
  };
};

export type PreviewWorkspaceProps = { children: ReactNode };
