# Testing

Automated tests do not use Facebook credentials or upload anything.

## Commands

```bash
npm run test:unit
npm run test:integration
npm test
npm run test:e2e
npm run test:large
```

End-to-end tests need a production build first:

```bash
npm run build
npm run test:e2e
```

`npm run verify` runs the type check, lint, unit and integration tests, and the production build.

Playwright starts the app through `scripts/electron-playwright.mjs`. Electron 45 rejects `--remote-debugging-port` when that flag is placed before the app path, which is how Playwright launches Electron. The wrapper moves the debugging flags after the app path. It also clears `ELECTRON_RUN_AS_NODE`, because that variable makes the Electron binary behave as plain Node and the window never opens.

## What the suites cover

Unit tests cover CRF and preset bounds, MB/GB conversion, audio and container budgeting, size estimates, space saved (including a larger output), FFmpeg argument arrays, filename and path checks, progress parsing, FFprobe JSON, cancellation of the queue, and the preset and results components.

Integration tests generate short synthetic videos with FFmpeg. They cover audio, no audio, a small frame that must not be upscaled, a larger frame that Facebook Ready limits, a frame-rate change, a broken file, a name containing spaces, cancellation, a two-pass size budget, and SSIM on the synthetic clip. The rotation fixture is created with FFmpeg's `-display_rotation 90` input option, which this FFmpeg 8 build stores as display-matrix side data. The older `-metadata:s:v rotate` tag is not reported by FFprobe here. If a future build stops exposing `side_data_list.rotation`, that test skips instead of failing on a missing fixture.

SSIM is an objective score. It is not proof that a person will see no difference, and synthetic test patterns compress more easily than camera footage.

## Compare pictures yourself

1. Compress a video in the app.
2. Choose Compare and play the original and the result from the same moment.
3. Or open both files in a video player and step through a detailed scene, a dark scene, and a scene with motion.
4. Optional command, from the project directory, after changing the paths:

```bash
ffmpeg -i compressed.mp4 -i original.mp4 -lavfi ssim -f null -
ffmpeg -i compressed.mp4 -i original.mp4 -lavfi psnr -f null -
```

The videos need the same timing. If the output was scaled, the filters have to scale one side first or the score is meaningless.

## 1.2 GB test

The script refuses to pretend a small file is large. It generates about 90 seconds of noisy 720p video, which is what makes the file reach about 1.2 GB. A plain test pattern at the same settings compresses far below that. It then compresses the file with the real encoder service, probes the output, and writes `docs/LARGE-FILE-REPORT.md`.

```bash
npm run test:large
```

You need roughly 4 GB free. The command runs through Vitest so the encoder TypeScript can be imported. If the disk is too full, the report says the test was not run and the Vitest check fails. It does not mark the test passed.

Windows uses the same npm script when Node, FFmpeg, and `ffprobe` are on `PATH`. Process sampling uses `ps` and only runs on macOS or Linux. The encode itself still runs on Windows.
