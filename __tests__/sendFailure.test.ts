import {sendFailedMessage} from '../src/stores/sendFailure';

describe('sendFailedMessage (#446)', () => {
  it('frames a group send failure as catching up (the caller kicks catchupNow)', () => {
    expect(sendFailedMessage(true)).toMatch(/catching up/i);
    expect(sendFailedMessage(true)).toMatch(/retry/i);
  });

  it('keeps the plain retry copy for a 1:1 send', () => {
    expect(sendFailedMessage(false)).toBe('send failed — tap the message to retry');
    // undefined (unknown convo) is treated as 1:1, not group.
    expect(sendFailedMessage(undefined)).toBe('send failed — tap the message to retry');
  });
});
