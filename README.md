# Colin's Bug Report Builder

Create GitHub-ready bug reports from your current VS Code session. It collects the project context people usually forget: active file, language, Git branch, workspace diagnostics, active-file diagnostics, VS Code version, OS info, and optional selected code.

## Features

- Prompt for title, observed behavior, expected behavior, and reproduction steps.
- Include active file metadata, selected line range, Git branch, workspace diagnostics, VS Code version, OS, and extension version.
- Add active-file diagnostics with severity, location, source, code, and message.
- Optionally include selected code and installed extension IDs.
- Open an unsaved Markdown draft, copy Markdown, save `BUG_REPORT.md`, or save and open it.

## Usage

Run **Colin's Bug Report Builder: Create Bug Report** from the Command Palette. You can also right-click inside an editor and choose **Create Bug Report**.

The generated report is Markdown that is ready to paste into a GitHub issue.

## Privacy

Bug Report Builder does not send telemetry and does not upload your code. Selected code and installed extension IDs are included only when you choose to include them.

## Local Development

```sh
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository
```

Open this folder in VS Code and run **Run > Start Debugging** to test the extension in an Extension Development Host.
