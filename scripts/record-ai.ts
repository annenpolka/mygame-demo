import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Session, runReplay } from '../src/lab/session';
import { WatchPlayer } from '../src/ai/watch-player';
import { DT, VERSION } from '../src/content/data';
import type { CaptureFrame } from '../src/client/capture';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const out = resolve(value('--out', 'artifacts/recordings/ai-watch'));
const limit = Number(value('--seconds', '300'));
const fullRun = !args.includes('--seconds');
if (!Number.isFinite(limit) || limit <= 0 || limit > 600)
  throw new Error('--seconds must be greater than 0 and at most 600.');
const fps = 60;
const viewport = { width: 1920, height: 1440 };
mkdirSync(out, { recursive: true });
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceHash = createHash('sha256');
for (const name of (readdirSync('src', { recursive: true }) as string[])
  .filter((name) => /\.(ts|tsx|css)$/.test(name))
  .sort()) {
  sourceHash.update(name);
  sourceHash.update(readFileSync(join('src', name)));
}
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 5194, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let encoder: ReturnType<typeof spawn> | undefined;
const frames = createWriteStream(join(out, 'frames.jsonl'));
const startedAt = Date.now();
try {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5194/?capture=1');
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'AI鑑賞', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI再生速度', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'AI鑑賞を開始 →', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI鑑賞', exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  let status: CaptureFrame = await page.evaluate(() => window.__battleCapture!.begin());
  const initial = await page.evaluate(() => window.__battleCapture!.result());
  const twin = new Session();
  twin.restore(
    JSON.stringify({ kind: 'snapshot', version: VERSION, state: initial.state, log: initial.log }),
  );
  const twinPlayer = new WatchPlayer();
  twinPlayer.configure(initial.ai.policy, initial.ai.planning);
  twinPlayer.loadout = initial.ai.loadout;
  twinPlayer.speed = 1;
  encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-vcodec',
      'mjpeg',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'passthrough',
      '-movflags',
      '+faststart',
      join(out, 'picture.mp4'),
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let encoderError = '';
  encoder.stderr!.on('data', (chunk: Buffer) => (encoderError += chunk.toString()));
  const encoded = new Promise<void>((accept, reject) => {
    encoder!.on('error', reject);
    encoder!.on('close', (code) =>
      code === 0 ? accept() : reject(new Error(`ffmpeg ${code}: ${encoderError}`)),
    );
  });
  // Keep a rejection handler attached while frame generation is still in progress.
  void encoded.catch(() => {});
  let count = 0;
  let resultFrame: number | undefined;
  let savedIntermission = false;
  let lastProgress = Date.now();
  const cdp = await page.context().newCDPSession(page);
  while (count < Math.ceil(limit * fps)) {
    if (errors.length) throw new Error(errors.join('\n'));
    // Gameplay is stopped between explicit steps. Let React effects, lane
    // measurements and the compositor settle without advancing another tick.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 95,
      fromSurface: true,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 },
    });
    const jpeg = Buffer.from(capture.data, 'base64');
    if (!encoder.stdin!.write(jpeg)) await once(encoder.stdin!, 'drain');
    const record = {
      ...status,
      pts: count / fps,
      sha256: createHash('sha256').update(jpeg).digest('hex'),
    };
    if (!frames.write(JSON.stringify(record) + '\n')) await once(frames, 'drain');
    if (count === 0 || count === 300 || (status.phase === 'loot' && !savedIntermission))
      writeFileSync(join(out, `frame-${String(count).padStart(6, '0')}.jpg`), jpeg);
    if (status.phase === 'loot') savedIntermission = true;
    count++;
    if (['victory', 'defeat'].includes(status.phase)) {
      resultFrame ??= count - 1;
      if (count - resultFrame >= 2 * fps) break;
    }
    if (count >= Math.ceil(limit * fps)) break;
    status = await page.evaluate(() => window.__battleCapture!.step());
    twinPlayer.advance(twin, DT);
    if (Date.now() - lastProgress > 10000) {
      console.log(
        JSON.stringify({
          frames: count,
          videoSeconds: count / fps,
          ...status,
          renderFps: Number((count / ((Date.now() - startedAt) / 1000)).toFixed(1)),
        }),
      );
      lastProgress = Date.now();
    }
  }
  encoder.stdin!.end();
  await encoded;
  frames.end();
  await once(frames, 'finish');
  const result = await page.evaluate(() => window.__battleCapture!.result());
  if (fullRun && !['victory', 'defeat'].includes(result.state.phase))
    throw new Error('The full AI run did not finish within the recording limit.');
  if (!isDeepStrictEqual(runReplay(result.recording), result.state))
    throw new Error('Recorded input replay does not match the filmed final state.');
  if (!isDeepStrictEqual(twin.state, result.state) || twinPlayer.decisions !== result.ai.decisions)
    throw new Error('The independent fixed-step AI run differs from the filmed run.');
  const audio = await page.evaluate(
    (duration) => window.__battleCapture!.audio(duration),
    count / fps,
  );
  writeFileSync(join(out, 'sound.wav'), Buffer.from(audio, 'base64'));
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    join(out, 'picture.mp4'),
    '-i',
    join(out, 'sound.wav'),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-t',
    String(count / fps),
    join(out, 'ai-watch.mp4'),
  ]);
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', join(out, 'ai-watch.mp4')],
      { encoding: 'utf8' },
    ),
  );
  const video = probe.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === 'video',
  );
  if (Number(video.nb_read_frames) !== count || video.avg_frame_rate !== '60/1')
    throw new Error('Encoded video frame count/rate differs from rendered frames.');
  const pts = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'csv=p=0',
      join(out, 'ai-watch.mp4'),
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .trim()
    .split('\n')
    .filter((line) => /^\d/.test(line))
    .map((line) => Number(line.split(',')[0]));
  if (pts.length !== count || pts.some((time, index) => Math.abs(time - index / fps) > 0.000001))
    throw new Error('Encoded frame timestamps are not a continuous 60 fps sequence.');
  writeFileSync(join(out, 'replay.json'), JSON.stringify(result.recording));
  writeFileSync(join(out, 'final-state.json'), JSON.stringify(result.state));
  writeFileSync(join(out, 'sound-cues.json'), JSON.stringify(result.cues));
  const report = {
    sourceHead,
    sourceSha256: sourceHash.digest('hex'),
    version: VERSION,
    createdAt: new Date().toISOString(),
    config: result.recording.initial.config,
    ai: result.ai,
    viewport,
    fps,
    frames: count,
    duration: count / fps,
    result: result.state.phase,
    encounters: result.state.encounter,
    audioCues: result.cues.length,
    audioSampleRate: 48000,
    replayMatches: true,
    independentRunMatches: true,
    frameCountMatches: true,
    uniformFramePts: true,
    codec: video.codec_name,
    browser: browser.version(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    capture:
      'one WatchPlayer.advance(DT) per frame; two native render frames to settle layout without advancing gameplay; awaited JPEG capture and encoder backpressure; original combat effects; decorative CSS transitions disabled',
    command: `npm run record:ai -- --out ${out}${fullRun ? '' : ` --seconds ${limit}`}`,
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  encoder?.stdin?.destroy();
  if (encoder && encoder.exitCode === null) encoder.kill();
  frames.destroy();
  await browser.close();
  await server.close();
}
