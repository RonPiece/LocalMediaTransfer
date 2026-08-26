import {
  MEDIA_GRID_VIRTUALIZATION,
  MEDIA_IMAGE_PERFORMANCE,
  mediaGridRowLayout,
} from './mediaGridPerformance';

describe('media grid performance contract', () => {
  it('keeps the virtualized thumbnail window bounded', () => {
    expect(MEDIA_GRID_VIRTUALIZATION).toEqual({
      initialNumToRender: 18,
      maxToRenderPerBatch: 18,
      updateCellsBatchingPeriod: 32,
      windowSize: 5,
    });
  });

  it('avoids retaining decoded thumbnails in memory and resizes early on iOS', () => {
    expect(MEDIA_IMAGE_PERFORMANCE).toEqual({
      cachePolicy: 'disk',
      enforceEarlyResizing: true,
      transition: 0,
    });
  });

  it('uses the row index supplied by a multi-column FlatList without dividing it again', () => {
    expect(mediaGridRowLayout(132, 56)).toEqual({
      length: 132,
      offset: 7392,
      index: 56,
    });
  });
});
