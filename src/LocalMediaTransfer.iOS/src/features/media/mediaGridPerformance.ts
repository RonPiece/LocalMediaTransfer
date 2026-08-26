export const MEDIA_GRID_VIRTUALIZATION = {
  initialNumToRender: 18,
  maxToRenderPerBatch: 18,
  updateCellsBatchingPeriod: 32,
  windowSize: 5,
} as const;

export const MEDIA_IMAGE_PERFORMANCE = {
  cachePolicy: 'disk',
  enforceEarlyResizing: true,
  transition: 0,
} as const;

export function mediaGridRowLayout(itemOuterSize: number, rowIndex: number) {
  // FlatList groups the source data into rows before VirtualizedList calls
  // getItemLayout when numColumns > 1. The supplied index is already a row
  // index; dividing it by the column count creates increasingly wrong spacer
  // offsets and eventually a mostly blank viewport.
  return {
    length: itemOuterSize,
    offset: itemOuterSize * rowIndex,
    index: rowIndex,
  };
}
