最后修改日期：2026-10-20（America/Los_Angeles）

# Ziyou Music Player · 自用音乐播放器

A bilingual local music player for the web and macOS. Browse and play music from your own library, organize albums and artists, follow synchronized lyrics, and optionally separate vocals on supported Apple Silicon Macs.

一个支持网页和 macOS 的双语本地音乐播放器。浏览并播放自己的音乐库，整理专辑和歌手，查看同步歌词；在支持的 Apple Silicon Mac 上还可选择分离人声。

**License:** GPL-3.0-or-later. See [LICENSE](LICENSE) and [third-party notices](src-tauri/resources/THIRD_PARTY_NOTICES.md).

**Try the web app:** [Open Ziyou Music Player](https://jaywu0713-bot.github.io/ziyou-music-player/). **Download the macOS app:** [Latest release](https://github.com/jaywu0713-bot/ziyou-music-player/releases/latest).

## What it does

- Plays local audio files and keeps the library, playlists, lyrics, and artwork in the user's browser or on their Mac.
- Organizes albums and artists, supports editable categories, and provides a visible play queue.
- Shows synchronized lyrics, a transparent floating lyrics window, a mini-player, and audio visualization in the macOS app.
- Searches free online music from Jamendo when the user supplies their own Jamendo Client ID.
- Can search for lyrics, artwork, and track metadata. Search terms are sent to the selected external providers; audio files are not uploaded.
- Offers optional on-device vocal separation on Apple Silicon Macs. The model is downloaded on demand; processing runs locally.

## Web app

Requirements: Node.js 22.13 or newer and a current desktop Chrome or Edge browser. Folder binding depends on browser support; other browsers may require selecting music files again after closing the page.

```sh
npm ci
npm run dev
```

Open the local address printed by the dev server. The app reads local files after the user selects them. It does not upload music to this project. Metadata, lyric, cover, and free-catalog searches contact their respective providers; availability and terms can change.

GitHub Pages publishes the browser app as static files. It supports local playback, library management, lyrics, and browser-compatible features. The Pages build cannot run `/api/covers`, so online cover search is disabled there with an explanatory message. The regular `npm run dev` development server and Cloudflare Worker build retain the server endpoint.

## macOS app

The current desktop target is macOS 15 or newer on Apple Silicon. The project has not been tested as a universal or Intel Mac build. Building requires Node.js 22.13+, Rust stable, Xcode Command Line Tools, and Python 3.13 for the optional vocal engine.

Prebuilt Apple Silicon downloads are attached to the [latest GitHub Release](https://github.com/jaywu0713-bot/ziyou-music-player/releases/latest). Releases include a DMG and a ZIP fallback. The current public build is unsigned and not notarized, so macOS may show a security warning on first launch.

```sh
npm ci
npm run desktop
```

To build an app bundle/DMG, prepare the optional local vocal engine first:

```sh
python3 -m venv .venv-vocal
.venv-vocal/bin/python -m pip install -r scripts/vocal-engine-requirements.txt
scripts/package-vocal-engine.sh
npm run desktop:package
```

The vocal engine is built locally and is excluded from this repository because it is a large machine-specific binary. The app can run without the engine, but vocal separation will not be available until it is built. Unsigned builds may trigger a macOS security warning. This source repository does not currently provide signed or notarized installers.

## Development checks

```sh
npm test
npx tsc --noEmit
npm run desktop:build
npm run build
```

Browser interaction tests use Playwright; see `npm run test:browser`. Native file permissions, floating windows, and packaging must be verified on a Mac.

## Privacy and external services

Music files remain on the user's device. The app stores library and playback preferences in local browser or app storage. Online search features send search terms or track metadata to the chosen third-party service. Jamendo playback requires a Client ID entered by the user. This project does not include or share a developer API key.

## Contributing

Issues and pull requests are welcome. Before opening a change, run the development checks above and include the platform/browser used for manual testing where relevant.
