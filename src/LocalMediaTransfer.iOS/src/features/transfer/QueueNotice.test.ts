import { QueueNotice } from './QueueNotice';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('requires an actual upload and dwell, then holds visible notices before clearing', () => {
  let started = false;
  const visible = jest.fn();
  const notice = new QueueNotice(() => true, () => started, visible);
  notice.update(true);
  jest.advanceTimersByTime(2000);
  expect(visible).not.toHaveBeenCalled();
  started = true;
  notice.update(true);
  jest.advanceTimersByTime(999);
  expect(visible).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(visible).toHaveBeenLastCalledWith(true);
  notice.update(false);
  jest.advanceTimersByTime(749);
  expect(visible).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(visible).toHaveBeenLastCalledWith(false);
});

it('clears pending notices on cancellation and does not schedule after completion', () => {
  let active = true;
  const visible = jest.fn();
  const notice = new QueueNotice(() => active, () => true, visible);
  notice.update(true);
  notice.dispose();
  active = false;
  notice.update(true);
  jest.runAllTimers();
  expect(visible).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
