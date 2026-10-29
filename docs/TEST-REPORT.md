# Test report

Recorded on macOS arm64 (Darwin 25.1) with Node.js v24.22.0 and FFmpeg 8.1.2 from Homebrew (`/opt/homebrew/bin/ffmpeg`). That build includes `libx264` and `h264_videotoolbox`. It does not include NVENC or Intel Quick Sync. Commands below were run in this workspace. A check that did not run is not listed as passed.

## Passed

| Check                      | Result    |
| -------------------------- | --------- |
| `npm run typecheck`        | Passed    |
| `npm run lint`             | Passed    |
| `npm run format:check`     | Passed    |
| `npm run test:unit`        | 27 passed |
| `npm run test:integration` | 10 passed |
| `npm run test:e2e`         | 2 passed  |
| `npm run test:large`       | 1 passed  |
| `npm run build`            | Passed    |

The production bundle is `out/main/index.js` (88.15 kB), `out/preload/index.cjs` (2.18 kB), and `out/renderer/` (`index--RsQLpwu.js`, 257.02 kB). End-to-end tests launched that bundle.

Unit tests cover preset and CRF bounds, bitrate and unit math, estimates, space saved, FFmpeg arguments, filenames, paths, progress parsing, FFprobe JSON, and queue cancellation.

Integration tests used short synthetic videos. They passed for every preset, no upscale, Facebook Ready downscale, audio removal, a silent source, a frame-rate change, a filename with spaces, a truncated input that must not look successful, cancellation and temp cleanup, a two-pass size budget, higher SSIM for Maximum Quality than Small File on the same test pattern, and a display-matrix rotation of 90 degrees. SSIM here only compares that synthetic pattern. It is not a claim of visually lossless output.

End-to-end tests launched the app, read metadata for a 320×240 clip, compressed with Balanced, showed “Output verified”, compared both videos, recorded the output path from Open folder, and returned to the empty state. A second test cancelled a longer veryslow encode and showed the cancellation message. The original files were not the outputs of those jobs.

## 1.2 GB file

`npm run test:large` generated a noisy 90 second 720p file and compressed it with the app’s encoder service. Details are in [LARGE-FILE-REPORT.md](LARGE-FILE-REPORT.md).

| Item            | Value                                         |
| --------------- | --------------------------------------------- |
| Source          | 1.24 GB (1,244,233,882 bytes), 90 s, 1280×720 |
| Settings        | Balanced CRF 23, x264 veryfast, AAC 160 kbps  |
| Output          | 848 MB (847,547,298 bytes), 31.9% smaller     |
| Encode time     | 24.0 seconds                                  |
| Peak FFmpeg RSS | 298.6 MB (sampled once a second)              |
| FFprobe         | h264, aac, 1280×720                           |

A plain test pattern at the same bitrate target was only about 208 MB, because x264 could not spend the budget on simple frames. The passing run used added noise so the file actually reached this size. No SSIM or PSNR pass was run on the full 90 second file.

## Launch

The end-to-end run started Electron 45 on the production bundle, with `ELECTRON_RUN_AS_NODE` removed. The window showed Smart MP4 Compressor, FFmpeg ready, and the compression flow above. Playwright starts the app through `scripts/electron-playwright.mjs` because Electron 45 rejects `--remote-debugging-port` when that flag is placed before the app path.

## Not run

- Windows and Linux. Path checks, `NUL`, and `taskkill` are in the code and were not executed on those systems.
- An encode with Apple VideoToolbox. The encoder is present in this FFmpeg build and the window can offer it. The automated encodes used libx264.
- NVENC and Quick Sync. This FFmpeg build does not list those encoders.
- `ffmpeg-static` and `ffprobe-static` binaries. The packages are optional and their install scripts did not run, so discovery uses the system FFmpeg.
- A signed `.dmg` or Windows installer. `npm run build` is the production bundle, not an installer.
- A full-file visual metric on the 1.2 GB source.
