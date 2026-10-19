import React from 'react';
import { MediaReviewView } from '@/platform/android/media/MediaSelectionScreen';
import { sampleMedia } from './fixtures';

const androidMedia = sampleMedia.map(item => ({ ...item, nativeReference: item.id, thumbnailUri: item.uri }));

export function PreviewMediaPicker({ id, onTransfer, onClose }: {
  id: string; onTransfer: () => void; onClose: () => void;
}) {
  const [items, setItems] = React.useState(id === 'media-empty' ? [] : androidMedia.slice(0, id === 'media-large' ? 320 : 12));
  return <MediaReviewView items={items} opening={false}
    openPicker={() => setItems(androidMedia.slice(0, 24))}
    remove={uri => setItems(current => current.filter(item => item.nativeReference !== uri))}
    onTransfer={onTransfer} onDisconnect={onClose} />;
}
