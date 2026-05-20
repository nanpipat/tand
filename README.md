# tand

tand is a compact desktop API client for working with file-based request collections. It is built with Tauri, React, and Monaco Editor.

## Features

- Send scratch API requests without opening a folder
- Save requests as readable JSON files when a project folder is selected
- Open local folders and manage request files
- Params, headers, body, auth, settings, and pre-request notes
- Environment variables with preview and unresolved-variable checks
- JSON formatting for request and response bodies
- Read-only response viewer with copy support
- Response panel placement on the right or at the bottom
- Native macOS app menu with `File > New Window`
- New windows open as a clean scratch workspace
- Request history stored locally

## Development

Install dependencies:

```bash
npm ci
```

Run the web UI:

```bash
npm run dev
```

Run the Tauri app in development:

```bash
npm run tauri dev
```

Build the desktop app:

```bash
npm run tauri build
```

## Release Builds

Releases are built by GitHub Actions when a version tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds the Windows app on a Windows runner and uploads the installer artifacts to the GitHub Release.

## Local Data

tand stores local config and history under:

```text
~/.tand
```

Request collections are normal folders on disk. Each saved request is a `.json` file.
