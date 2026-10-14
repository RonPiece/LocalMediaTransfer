import { formatBytes, groupFailureResults } from './transferPresentation';

it('formats transfer sizes with decimal MB and GB', () => {
  expect(formatBytes(1_000_000)).toBe('1.0 MB');
  expect(formatBytes(1_000_000_000)).toBe('1.0 GB');
});

describe('groupFailureResults', () => {
  it('groups repeated failures by actionable reason and keeps bounded examples', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      id: `failure-${index}`,
      filename: `file-${index}.jpg`,
      status: 'error' as const,
      msg: 'Not enough temporary storage.',
    }));

    expect(groupFailureResults(files)).toEqual([{
      id: 'failure-group-1',
      count: 5,
      message: 'Not enough temporary storage.',
      sampleFilenames: ['file-0.jpg', 'file-1.jpg', 'file-2.jpg'],
    }]);
  });

  it('excludes non-error results', () => {
    expect(groupFailureResults([{
      id: 'success',
      filename: 'ok.jpg',
      status: 'success',
    }])).toEqual([]);
  });
});
