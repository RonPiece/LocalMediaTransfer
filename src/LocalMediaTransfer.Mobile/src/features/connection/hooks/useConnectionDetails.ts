import React from 'react';
import type { ActiveConnection } from '../connectionPresentation';

/** Read-only details cannot survive a disconnect or receiver change. */
export function useConnectionDetails(connection: ActiveConnection | null) {
  const address = connection?.address ?? null;
  const [selection, setSelection] = React.useState({ address, open: false });
  if (selection.address !== address) setSelection({ address, open: false });
  return {
    visible: !!address && selection.address === address && selection.open,
    open: () => { if (address) setSelection({ address, open: true }); },
    close: () => setSelection({ address, open: false }),
  };
}
