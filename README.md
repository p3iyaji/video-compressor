# Smart MP4 Compressor

A desktop app for making large MP4 files smaller on your own computer. Nothing is uploaded. Compression is lossy: a smaller file does not keep every original detail, and the app does not claim that it does.

The default encoder is H.264 through FFmpeg `libx264`. Apple VideoToolbox, NVIDIA NVENC, and Intel Quick Sync appear only when the installed FFmpeg build actually lists them.

## Prerequisites

- Node.js 22 or newer (this project was built with Node 24)
- npm
- FFmpeg and FFprobe with `libx264` and AAC

Check the tools:

```bash
node -v
npm -v
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders | grep libx264
```

On Windows, use `findstr libx264` instead of `grep`.

### Install FFmpeg

macOS:

```bash
brew install ffmpeg
```

Windows (PowerShell):

```powershell
winget install Gyan.FFmpeg
```

Restart the terminal so `ffmpeg` and `ffprobe` are on `PATH`.

Linux (examples):

```bash
sudo apt install ffmpeg
sudo dnf install ffmpeg
```

The package must include `libx264`. A build without it cannot run the default presets.

The app looks for FFmpeg in this order: a binary you locate in the app, `FFMPEG_PATH` and `FFPROBE_PATH`, the system `PATH`, common install folders, then the optional `ffmpeg-static` and `ffprobe-static` packages if their binaries are present. It does not download FFmpeg while you compress. Those npm packages ship separate FFmpeg binaries under the GPL because of libraries such as x264. This app does not link them; it starts FFmpeg as its own process. If npm skipped the `ffmpeg-static` install script, the system FFmpeg is used instead. Approve that script only if you want the bundled fallback:

```bash
npm install-scripts approve ffmpeg-static
npm rebuild ffmpeg-static ffprobe-static
```

## Install and run

```bash
npm install
npm run dev
```

Production build, then open the built app:

```bash
npm run build
npm run preview
```

`npm run build` writes the main process, preload, and renderer into `out/`. That is the production build this repo runs in CI-style checks. A signed `.dmg` or Windows installer is not produced here.

### Useful scripts

| Command              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `npm run dev`        | Electron with Vite hot reload                                      |
| `npm run build`      | Production bundle                                                  |
| `npm run preview`    | Opens the production bundle                                        |
| `npm run typecheck`  | Strict TypeScript for the main process and the Vue app             |
| `npm run lint`       | ESLint                                                             |
| `npm run test`       | Unit and integration tests                                         |
| `npm run test:e2e`   | Playwright against the built Electron app                          |
| `npm run test:large` | Local ~1.2 GB encode                                               |
| `npm run verify`     | Typecheck, lint, tests, and production build                       |
| `npm run sample`     | Writes `tmp/sample.mp4` (optional seconds: `npm run sample -- 10`) |

## How to compress a large video

1. Drop an `.mp4` on the window, or choose Browse. The file is not loaded into the page. FFprobe reads the header and FFmpeg streams the frames.
2. Check the size, duration, resolution, frame rate, codecs, and bitrate.
3. Pick a preset or a target size. Read the pre-export summary. The size number for CRF is a rough estimate.
4. Choose Compress. One job runs at a time. More files wait in the queue.
5. Cancel stops FFmpeg and deletes the partial file. The original stays where it was.
6. After FFmpeg exits cleanly and FFprobe can read the new file, the app shows the real sizes and the space saved. If the new file is larger, the percentage is negative.

Files around 1.2 GB are normal for this tool as long as the disk has room for the output and a little working space. Expect the encode to take about as long as the video, often longer for the Slow and Veryslow presets. A 10 minute 1080p clip on a laptop can take anywhere from a few minutes to well over ten, depending on the preset and the CPU.

## Which preset to choose

| Preset          | Use it when                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum Quality | You want the least practical loss. CRF 18, slow preset, original size and frame rate. Still lossy.                                                 |
| High Quality    | You want a clear picture and a smaller file. CRF 22, original size and frame rate.                                                                 |
| Balanced        | You want the default. CRF 23.                                                                                                                      |
| Small File      | You need a much smaller file and can accept visible softness or blocking. CRF 28.                                                                  |
| Facebook Ready  | You want H.264, AAC, yuv420p, and fast start. 1080p sources stay 1080p. Larger frames are limited to a 1080p box. Smaller videos are not enlarged. |

Facebook's length and size limits depend on the product (Feed, Reels, Stories, and others) and on the account. This app does not log in to Facebook and does not guarantee that an upload will be accepted. The pre-export panel shows the resolution, codecs, fast start, and the size estimate before you encode.

Changing a custom control switches the preset label to Custom. The controls are the resolution, CRF, encoder speed, audio mode and bitrate, frame rate, fast start, encoder, file name, and destination.

Resolution choices are Original, 2160p, 1440p, 1080p, 720p, or a custom box. The picture keeps its aspect ratio and is never upscaled. Odd sizes are rounded down to even numbers because yuv420p needs that.

## Target file size

Turn on a budget of 100, 250, 500, 700, or 900 MB, or type a custom MB or GB value. Units are decimal: 1 MB = 1,000,000 bytes, 1 GB = 1,000,000,000 bytes, matching FFmpeg bitrates.

The app:

1. Reads the duration with FFprobe.
2. Converts the budget to a total bitrate.
3. Reserves 2% for the container and the selected audio bitrate (or the source audio bitrate if you copy audio, or nothing if you remove audio).
4. Gives the rest to the video, and stops if that would be under 100 kbps.
5. Warns when the bits per pixel are low, and asks you to confirm a very aggressive budget. Balanced CRF 23 is the suggested alternative.
6. Uses two-pass libx264 when that option is on. Hardware encoders use one bitrate pass.
7. Labels the figure as a budget. The finished file can be smaller or slightly larger.
8. Calls the budget met only when the output is within 8% over the request. Under the budget counts as met. A larger miss is reported with the real size and a single retry that lowers the video bitrate. There is no automatic retry loop.

A video with no duration cannot use target size.

## Verify a Facebook-ready file

After the Facebook Ready preset finishes, FFprobe should show:

- container: MP4
- video: `h264`
- pixel format: `yuv420p` (the encode requests this)
- audio: `aac`, unless the source had no audio
- long side at most 1920 and short side at most 1080
- `moov` atom suitable for fast start when that option was left on

```bash
ffprobe -hide_banner -show_streams -show_format output.mp4
```

Play it in the app comparison view before uploading. Facebook may compress it again.

## Troubleshooting

| Symptom                                       | What to do                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg was not found                          | Install it with the commands above, reopen the app, or use Locate FFmpeg.                                                             |
| Unknown encoder `libx264`                     | Your build lacks x264. Install a GPL-enabled FFmpeg.                                                                                  |
| Hardware encoder failed / compression session | The GPU encoder is busy or blocked. Switch to Software (libx264).                                                                     |
| Corrupt, moov atom, or invalid data           | The MP4 is incomplete or damaged. The app will not call that a success.                                                               |
| No space left on device                       | Free disk space. The original is untouched. Delete any `.partial.mp4` left beside the destination if a crash happened before cleanup. |
| Permission denied                             | Pick a folder you can write to.                                                                                                       |
| Output already exists                         | Confirm overwrite. The source file is not the file that gets replaced.                                                                |
| The encode was interrupted                    | Start it again. Partial encodes are not resumed.                                                                                      |
| The file is still large                       | CRF 18 and slow settings keep more data. Use Balanced, Small File, or a size budget.                                                  |
| The picture looks bad                         | Raise the quality (lower CRF) or raise the size budget. Small File and very small budgets are expected to look worse.                 |
| Progress has no percentage                    | The file has no duration metadata. Elapsed time and output size still update.                                                         |

## Disk space and time

Keep free space for the output plus a few hundred megabytes. Two-pass does not store a second full copy of the video, but a cancelled job can leave a partial file for a moment; the app deletes it. Very slow presets use more CPU time and similar disk. The renderer does not hold the movie in memory.

## Privacy

Processing stays on the machine. There is no account, no analytics call, and no upload. Job history in the app data folder stores paths and settings so an interrupted job can be shown as interrupted. You can remove that history with Clear finished, or delete the user-data folder for the app.

## Supported systems

macOS and Windows are the targets. The path checks, null device (`/dev/null` or `NUL`), and process kill path include Windows. This copy was developed and tested on macOS. Linux uses the same code when FFmpeg is installed; it was not part of the automated run on this machine.

## Known limits

- Input is `.mp4` only. The output is always H.264 in MP4.
- Only the first video stream and the first audio stream are kept. Extra audio and subtitles are dropped.
- Copy audio works for ordinary AAC. Anything else is converted, with a warning.
- Variable frame rate is kept when you leave frame rate on Original (`fps_mode passthrough`). Choosing 30 fps or a custom value makes a constant frame rate.
- Display rotation is applied by FFmpeg's normal autorotate so the picture stays upright. The app does not add its own rotate or crop.
- Anamorphic or unusual pixel aspect ratios are approximated from the display size. Check the preview if the source is not square-pixel.
- Hardware quality numbers are not x264 CRF, even when the slider shows the same figure.
- CRF size estimates are rough. Scene complexity moves the real size.
- A crashed process can leave a partial file. The next launch will not delete an unknown partial automatically if it was not recorded. The source is still safe.
- Objective scores (SSIM) on test patterns are not a visual guarantee.

## Tests and the 1.2 GB run

See [docs/TESTING.md](docs/TESTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/TEST-REPORT.md](docs/TEST-REPORT.md). The report is written from commands that were actually run. A test that did not run is not listed as passed.

Manual 1.2 GB check:

```bash
npm run test:large
```

The script's own report is `docs/LARGE-FILE-REPORT.md`.
