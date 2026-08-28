import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'src/stores/chatStore.ts'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'src/screens/ChatScreen.tsx'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'src/components/BubbleActionMenu.tsx'), 'utf8');

describe('hosted voice delivery', () => {
  it('uploads encrypted local audio and sends only a compact store2 marker', () => {
    const start = store.indexOf('sendVoice: async');
    const end = store.indexOf('\n  forwardMessage:', start);
    const body = store.slice(start, end);
    expect(body).toMatch(/AudioRecorder\.saveBase64Audio\(rec\.base64\)/);
    expect(body).toMatch(/Storage\.uploadEncrypted\(path,/);
    expect(body).toMatch(/mime:\s*rec\.mime/);
    expect(body).toMatch(/width:\s*rec\.durationMs/);
    expect(body).toMatch(/height:\s*1/);
    expect(body).toMatch(/sendHostedMarker\(convoPk, marker\)/);
    expect(body).not.toMatch(/get\(\)\.send\(convoPk, marker\)/);
  });

  it('routes every hosted marker through the Logos-only helper', () => {
    expect(store).toMatch(/async function sendHostedMarker[\s\S]{0,220}?LogosChat\.sendMessageTo/);
    expect(store).not.toMatch(/get\(\)\.send\(convoPk, marker\)/);
    expect((store.match(/await sendHostedMarker\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('never uploads voice from a storage-off group', () => {
    const body = store.slice(store.indexOf('sendVoice: async'), store.indexOf('forwardMessage: async'));
    expect(body).toMatch(/storageOff\[convoPk\]/);
    expect(body).toMatch(/MAX_INLINE_VOICE_BASE64_CHARS/);
    expect(body).toMatch(/LogosChat\.sendVoiceTo/);
    expect(body.indexOf('storageOff[convoPk]')).toBeLessThan(body.indexOf('Storage.uploadEncrypted'));
    expect(body).toMatch(/voice note is too long while Storage is off/);
  });

  it('renders hosted audio as a voice bubble after decryption', () => {
    expect(screen).toMatch(/hostedVoice/);
    expect(screen).toMatch(/mime\.startsWith\('audio\/'\)/);
    expect(screen).toMatch(/<VoiceBubble[\s\S]*path=\{media\.path\}/);
    expect(screen).toMatch(/voice message unavailable — tap to retry/);
    expect(screen).toMatch(/onPress=\{media\.retry\}/);
  });

  it('does not silently swallow a voice-send exception', () => {
    const start = screen.indexOf('const finishRecord = async');
    const end = screen.indexOf('\n  const onSubmit', start);
    const body = screen.slice(start, end);
    expect(body).toMatch(/catch \(e: any\)/);
    expect(body).toMatch(/voice send failed/);
    const sendVoice = store.slice(store.indexOf('sendVoice: async'), store.indexOf('forwardMessage: async'));
    expect(sendVoice).toMatch(/voice notes are not supported on mesh'\}\);[\s\S]{0,80}?throw new Error/);
    expect(sendVoice).toMatch(/Node is off or connecting[\s\S]{0,180}?throw new Error/);
  });

  it('does not reintroduce oversized inline voice when forwarding legacy notes', () => {
    const forward = store.slice(store.indexOf('forwardMessage: async'), store.indexOf('sendReaction: async'));
    expect(forward).not.toContain('sendVoiceTo');
    expect(forward).toMatch(/get\(\)\.sendVoice\(toConvoPk/);
  });

  it('keeps hosted forwarding off mesh and out of storage-off groups', () => {
    const forward = store.slice(store.indexOf('forwardMessage: async'), store.indexOf('sendReaction: async'));
    expect(forward).toMatch(/containsHostedMarker\(content\)/);
    expect(forward).toMatch(/isMedia = img != null \|\| voc != null \|\| containsHosted/);
    expect(forward).toMatch(/storageOff\[toConvoPk\]/);
    expect(forward).toMatch(/sendHostedMarker\(toConvoPk, content\)/);
    expect(forward).toMatch(/throw e/);
    expect(forward).toMatch(/media cannot be forwarded to a mesh chat'\}\);[\s\S]{0,80}?throw new Error/);
    expect(forward).toMatch(/media cannot be forwarded while Storage is off'\}\);[\s\S]{0,80}?throw new Error/);
  });

  it('shows Forwarded only after the asynchronous forward succeeds', () => {
    const picker = screen.slice(screen.indexOf('<ForwardPicker'), screen.indexOf('<MapMeshIdentityModal'));
    expect(picker).toMatch(/onPick=\{async pk/);
    expect(picker.indexOf('await forwardMessage(c, pk)')).toBeLessThan(picker.indexOf("ToastAndroid.show('Forwarded'"));
  });

  it('propagates native image/text delivery failures to the forward UI', () => {
    const forward = store.slice(store.indexOf('forwardMessage: async'), store.indexOf('sendReaction: async'));
    const send = store.slice(store.indexOf('send: async'), store.indexOf('retry: async'));
    expect(forward).toMatch(/JSON\.parse\([\s\S]{0,100}?LogosChat\.sendImageTo/);
    expect(forward).toMatch(/image forward failed/);
    expect(send).toMatch(/if \(!meshOk\) throw new Error\(sendFailedMessage/);
    expect(send).toMatch(/throw new Error\(sendFailedMessage\(convo\?\.isGroup\)\)/);
    expect(send).toMatch(/await get\(\)\.loadMessages\(convoPk\)/);
  });

  it('never offers Copy message for direct or reply-wrapped hosted refs', () => {
    expect(actions).toMatch(/containsSensitiveHostedReference\(target\.text\)/);
    expect(actions).toMatch(/if \(!isImage && !isVoice && !isHosted\)/);
  });

  it('routes reply-wrapped hosted refs through Logos-only forwarding', () => {
    expect(store).toMatch(/const containsHostedMarker = containsSensitiveHostedReference/);
    expect(store).toMatch(/else if \(containsHosted\)[\s\S]{0,220}?sendHostedMarker\(toConvoPk, content\)/);
  });

  it('keeps hosted and avatar refs out of Logos-to-mesh relay', () => {
    expect(store).toMatch(/containsSensitiveHostedReference/);
    expect(store).toMatch(/!isImageContent\(e\.detail\) &&[\s\S]{0,100}?!containsHostedMarker\(e\.detail\)/);
    expect(store).toMatch(/const marker = encodePfp\(ref\)[\s\S]{0,300}?sendHostedMarker\(c\.convoPk, marker\)/);
  });
});