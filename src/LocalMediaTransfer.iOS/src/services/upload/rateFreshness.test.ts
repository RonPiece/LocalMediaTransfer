import { isRateFresh, rateStaleAfterMs } from './rateFreshness';

it('keeps a slow chunk rate alive for two expected acknowledgement intervals', () => {
  expect(rateStaleAfterMs(50)).toBe(5000);
  expect(rateStaleAfterMs(1)).toBe(16777.216);
  expect(rateStaleAfterMs(0.1)).toBe(30000);
  expect(isRateFresh(1000, 50, 6000)).toBe(true);
  expect(isRateFresh(1000, 50, 6001)).toBe(false);
});
