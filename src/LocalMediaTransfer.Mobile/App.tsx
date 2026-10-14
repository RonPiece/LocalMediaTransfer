import React from 'react';
import AppShell from '@/app/AppShell';
import { ThemeProvider } from '@/theme';

export default function App() {
  return <ThemeProvider><AppShell /></ThemeProvider>;
}
