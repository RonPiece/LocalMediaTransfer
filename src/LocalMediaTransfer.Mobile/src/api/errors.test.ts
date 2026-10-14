import { ApiRequestError, isUnauthorizedError } from './errors';

it('recognizes the shared HTTP error identity', () => {
  expect(isUnauthorizedError(new ApiRequestError('synthetic', 401))).toBe(true);
});
it.each([null, new ApiRequestError('synthetic', 403), { status: 401 }, { errorCode: 'unauthorized' }])(
  'does not reinterpret other error representations as HTTP 401', error => {
    expect(isUnauthorizedError(error)).toBe(false);
  },
);
