import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.join(
    __dirname,
    '../android/app/src/main/java/com/logoschat/MediaVideoView.kt',
  ),
  'utf8',
);

describe('native video aspect-fit lifecycle', () => {
  it('reapplies the transform when MediaPlayer reports delayed video dimensions', () => {
    expect(source).toMatch(
      /setOnVideoSizeChangedListener\s*\{[\s\S]{0,160}?updateAspectFit\(\)/,
    );
  });
});
