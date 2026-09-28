import React from 'react';
import AppShell from '@/app/AppShell';
import { ThemeProvider } from '@/theme';
import { pruneProblemPreviews } from '@/services/history/ProblemPreviewStore';

export default function App() {
  React.useEffect(() => { void pruneProblemPreviews().catch(() => undefined); }, []);
  return <ThemeProvider><AppShell /></ThemeProvider>;
}
