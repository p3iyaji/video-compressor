# Architecture and security

Smart MP4 Compressor is a local Electron app. The renderer is a Vue 3 interface. FFmpeg and FFprobe run in the main process. No video, filename, or metadata is sent to a network service.

## Process boundaries

- `contextIsolation` is on.
- `nodeIntegration` is off.
- The renderer sandbox is on.
- The preload script exposes one object, `window.compressor`. It does not expose `ipcRenderer`, `fs`, or `child_process`.
- The sandboxed preload is built as CommonJS (`out/preload/index.cjs`). Electron's sandbox rejects an ESM preload (`Cannot use import statement outside a module`), so the bridge would never appear.
- IPC handlers reject messages whose frame URL is not the dev server or a `file:` page owned by this app.
- Navigation and extra windows are blocked. Permission requests (camera, microphone, and the rest) are denied.
- A Content Security Policy is applied in the main process. Development allows the Vite socket. Production does not.

## Files the renderer is allowed to touch

The main process keeps an allowlist of paths the user selected:

- Browse and drag-and-drop add an input only after the path is resolved, checked to be a real `.mp4` file, and rejected if it sits in a system location such as `/etc`, `/System`, or `Windows\System32`.
- The output folder is either the folder that contains that input or a folder picked with the system directory dialog.
- The output file name is sanitised to a single `.mp4` name. It cannot escape the chosen folder.
- The input and output paths must be different. The original file is never opened for writing and is never included in cleanup.
- In-app playback uses `media://local/<random token>`. The token is an allowlist key. The handler streams a byte range. It does not accept a raw filesystem path in the URL.
- Reveal, Play, and Save a copy only accept paths that belong to a job this session opened or created.

## FFmpeg

- FFmpeg is spawned with `shell: false` and an argument array. User paths are one argument each. They are never interpolated into a shell string.
- Discovery order is: a path saved in local settings, `FFMPEG_PATH` and `FFPROBE_PATH`, the system `PATH`, common install locations, then the optional `ffmpeg-static` / `ffprobe-static` packages if those binaries are present and executable.
- The app prefers a system FFmpeg that includes `libx264`. It does not download a binary at encode time.
- `libx264` is GPL software inside FFmpeg. This application does not link it. It executes FFmpeg as a separate process. See the README for install and licence notes.
- Hardware encoders (VideoToolbox, NVENC, Quick Sync) are offered only when `ffmpeg -encoders` lists them. They are never selected automatically. Their quality controls are not the same as x264 CRF.
- Two-pass size targeting is used for libx264. Hardware encoders get one bitrate pass and a warning.
- Progress comes from FFmpeg `-progress pipe:1`, not from scraping the normal console log.
- Output is written to a partial file in the destination folder, probed, then renamed. Pass logs live in a temp directory and are removed after success, failure, or cancel.
- Cancel sends `SIGTERM` (and `SIGKILL` if needed) on macOS and Linux, and `taskkill /T /F` on Windows.
- Closing the window aborts running encodes. A job that was running when the app died is marked interrupted on the next launch and is not resumed. The original video is left in place.

## Queue and disk

One encode runs at a time. Job state is JSON in the app's user-data folder. It stores paths and settings, not video bytes. The partial file and pass logs are deleted with a guard that refuses to delete the source path.

Target size is a budget. The planner subtracts 2% container overhead and the audio bitrate, then refuses video bitrates under 100 kbps. A very low bits-per-pixel target must be confirmed. If the file still misses the budget, the result says so and offers one bitrate retry. It does not loop.

## What this app does not do

- It does not upload videos or phone home.
- It does not promise visually lossless output. CRF and bitrate are lossy.
- It does not claim a file will be accepted by every Facebook surface. The Facebook Ready preset is a compatible H.264/AAC/yuv420p/fast-start encode, capped at a 1080p frame, never upscaled.
