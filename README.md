<br />
<p align="center">
  <img src="assets/images/logo-transparent.png" width="88" alt="tand logo" />
</p>

### tand - Local-first API client for exploring and testing APIs.

[![Release](https://img.shields.io/github/v/release/nanpipat/tand?label=release)](https://github.com/nanpipat/tand/releases/latest)
[![Release Build](https://github.com/nanpipat/tand/actions/workflows/release.yml/badge.svg)](https://github.com/nanpipat/tand/actions/workflows/release.yml)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/nanpipat/tand)](https://github.com/nanpipat/tand/pulse)
[![Download](https://img.shields.io/badge/Download-Latest-2dd4bf)](https://github.com/nanpipat/tand/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24c8db)](https://tauri.app)

tand is a compact desktop API workspace for sending scratch requests, saving file-based API collections, and keeping request data close to your machine.

tand stores requests as readable JSON files inside folders you choose. Open a project folder, create requests and environments, then commit the files with Git or any version control system your team already uses.

tand works without an account, cloud workspace, or remote sync. Your local config and history live on your device, and your API collections stay in normal folders on disk.

[Download tand](https://github.com/nanpipat/tand/releases/latest)

![tand](assets/images/tand-light.png#gh-light-mode-only)
![tand](assets/images/tand-dark.png#gh-dark-mode-only)

<br />

## Table of Contents

- [Installation](#installation)
- [Features](#features)
  - [Scratch requests](#scratch-requests)
  - [Folder-based collections](#folder-based-collections)
  - [Environments](#environments)
  - [Response workspace](#response-workspace)
  - [Native desktop workflow](#native-desktop-workflow)
- [Project Format](#project-format)
- [Development](#development)
- [Release Builds](#release-builds)
- [Local Data](#local-data)
- [Important Links](#important-links)
- [Contribute](#contribute)
- [License](#license)

## Installation

Download the latest build from [GitHub Releases](https://github.com/nanpipat/tand/releases/latest).

The project currently ships Windows release artifacts through GitHub Actions. macOS builds can be produced locally while code signing and notarization are not configured yet.

```sh
# Build the desktop app locally
npm ci
npm run tauri build
```

## Features

### Scratch requests

Start tand and send an API request immediately. You do not need to open a folder first.

If you save a scratch request, tand asks for a folder, creates a new request file, opens that folder as the workspace, and keeps you moving.

### Folder-based collections

Requests are saved as plain `.json` files in the folder you choose.

Use Git, another VCS, or simple file sharing to collaborate over API collections without a hosted workspace.

### Environments

Create environment files under `environments/`, add variables, select an active environment, and preview unresolved variables before sending requests.

### Response workspace

View response bodies in a read-only editor, format JSON, copy content, inspect headers, and move the response panel between the right side and the bottom.

### Native desktop workflow

tand is built with Tauri, React, and Monaco Editor. It includes a native macOS menu, `File > New Window`, light and dark themes, local request history, and a clean scratch window flow.

## Project Format

A tand workspace is just a folder on disk.

```text
my-api/
  health-check.json
  users/
    list-users.json
  environments/
    local.json
    staging.json
```

Request files are readable JSON:

```json
{
  "name": "health check",
  "request": {
    "method": "GET",
    "url": "https://example.com/health",
    "params": [],
    "headers": [],
    "body": { "type": "none", "content": null },
    "auth": { "type": "none" },
    "settings": {
      "followRedirects": true,
      "verifySsl": true,
      "timeoutMs": 30000,
      "proxy": null
    }
  }
}
```

## Development

Install dependencies:

```sh
npm ci
```

Run the web UI:

```sh
npm run dev
```

Run the Tauri app in development:

```sh
npm run tauri dev
```

Build the desktop app:

```sh
npm run tauri build
```

## Release Builds

Releases are built when a version tag is pushed:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds the Windows app on GitHub Actions and uploads installer artifacts to the GitHub Release.

## Local Data

tand stores app config and request history under:

```text
~/.tand
```

Request collections are not stored there. They remain in the folders you explicitly open or save to.

## Important Links

- [Latest Release](https://github.com/nanpipat/tand/releases/latest)
- [Release Workflow](https://github.com/nanpipat/tand/actions/workflows/release.yml)
- [Issues](https://github.com/nanpipat/tand/issues)
- [Tauri Documentation](https://tauri.app)

## Contribute

Issues and pull requests are welcome. If tand does not solve your API workflow yet, open an issue with the shape of your workspace, the request flow you expected, and what got in the way.

## License

No license has been published yet.
