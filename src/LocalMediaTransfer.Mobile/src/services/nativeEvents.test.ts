import { nativeEventRecord, parseNativeProgressEvent } from './nativeEvents';

it('accepts numeric progress and excludes unrecognized native fields', () => {
  expect(parseNativeProgressEvent({ fileId: 'synthetic', bytesSent: 1, totalBytes: 2, extra: true }))
    .toEqual({ fileId: 'synthetic', bytesSent: 1, totalBytes: 2 });
});
it.each([null, undefined, 'text', {}, { fileId: 'x', bytesSent: NaN, totalBytes: 1 },
  { fileId: 'x', bytesSent: 1, totalBytes: -1 }])('rejects malformed bridge progress', value => {
  expect(parseNativeProgressEvent(value)).toBeNull();
});
it('handles null native state events without throwing', () => {
  expect(nativeEventRecord(null)).toEqual({});
});
