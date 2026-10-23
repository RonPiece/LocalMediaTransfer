const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeEvidence } = require('../browser/diagnostics.cjs');

test('diagnostic exports strip nested header/body fields and redact credential spellings', () => {
    const credential = 'synthetic+credential/value';
    const exported = serializeEvidence({ traceEvents: [{ args: { data: {
        requestHeaders: [{ name: 'X-Upload-Token', value: credential }],
        responseHeaders: { 'Set-Cookie': credential }, requestBody: 'private',
        postData: 'private', duration: 12,
        url: '/?token=' + encodeURIComponent(credential), stack: credential
    } } }] }, [credential]);
    assert.equal(exported.includes('private'), false);
    assert.equal(exported.includes('X-Upload-Token'), false);
    assert.equal(exported.includes(credential), false);
    assert.equal(exported.includes(encodeURIComponent(credential)), false);
    assert.equal(JSON.parse(exported).traceEvents[0].args.data.duration, 12);
});
