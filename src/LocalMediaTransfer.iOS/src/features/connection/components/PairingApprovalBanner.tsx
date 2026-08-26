import React from 'react';
import { InlineBanner } from '@/components/ui';
import { connectionText } from '../content/connectionText';

export function PairingApprovalBanner({ desktopName }: { desktopName: string }) {
  return (
    <InlineBanner
      icon="hourglass-outline"
      title={connectionText.waitingApprovalTitle}
      message={connectionText.waitingApprovalMessage(desktopName)}
      tone="warning"
      className="w-full mb-6"
    />
  );
}
