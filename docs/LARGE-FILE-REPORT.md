# Large-file test

Status: **passed** on 2026-10-27T20:09:14.138Z.

| Item | Value |
| --- | --- |
| Source size | 1.24 GB (1244233882 bytes) |
| Source duration | 90 seconds |
| Source resolution | 1280×720 |
| Settings | Balanced CRF 23, x264 veryfast, AAC 160 kbps |
| Output size | 848 MB (847547298 bytes) |
| Space saved | 31.9% |
| Encode time | 24.0 seconds |
| Wall clock including report | 24.1 seconds |
| Peak FFmpeg RSS | 298.6 MB |
| FFprobe validation | video h264, audio aac, 1280×720 |
| Output path | `/Users/pauliyaji/Desktop/mp4-comp/tmp/large-file/compressed.mp4` |

The source was synthetic test video, generated locally. It was not a tiny file renamed to look large.

Objective visual metrics were not run on the full 90 second file. SSIM or PSNR on a short synthetic clip does not prove that a real camera recording is visually lossless. Compare the source and output in the app preview or a video player.

Peak memory is the largest sampled RSS of an `ffmpeg` process during the encode, which can miss a brief spike between samples.
