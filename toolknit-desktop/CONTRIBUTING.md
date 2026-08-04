# Contributing to ToolKnit Desktop

Thanks for helping improve ToolKnit. The project contains a Windows desktop application, a local CLI, and an MCP server. Small, focused contributions are easier to review and safer to release.

## Before you start

1. Search existing issues and discussions before opening a duplicate.
2. Fork the repository or create a branch from the current `main` branch.
3. Keep one logical change per pull request.
4. Never include API keys, tokens, private files, production output, or user media in commits, issues, logs, or screenshots.

## Local setup

```powershell
git clone https://github.com/ZihangDong/toolknit-desktop.git
Set-Location toolknit-desktop
npm ci
npx tauri dev
```

Requirements:

- Windows 10/11
- Node.js `20.12.0` or later
- Rust stable toolchain for native work

## Validation

Run the smallest relevant suite while developing, then run the shared checks before requesting review.

```powershell
npm run build
npm run test:help
npm run test:cli-agent
npm run test:dependencies

Set-Location src-tauri
cargo test --locked
Set-Location ..
```

Changes to AI documents or AI tables should also run `npm run test:ai-doc` or `npm run test:ai-table`. Changes to a specific local engine should run its matching `npm run test:<tool>` command.

## Design and product rules

- Preserve the local-first promise. A file must not leave the device unless the user explicitly invokes a configured AI provider.
- Preserve output safety. New writers must use an explicit destination, unique names, and atomic publication where practical.
- Keep desktop, CLI, and MCP behavior aligned. For a CLI/MCP-capable tool, document input, parameters, defaults, output, progress, errors, and overwrite behavior.
- Do not expose passwords, provider keys, absolute private paths, or file content in logs, command arguments, test fixtures, or screenshots.
- Follow the existing bilingual UI and documentation conventions when changing user-facing text.
- Avoid unrelated reformatting in the same pull request.

## Pull request checklist

- [ ] The PR explains the user-visible behavior change.
- [ ] Relevant tests and build commands pass locally.
- [ ] Help, CLI/MCP guides, and translations are updated when needed.
- [ ] No secret, personal file, generated runtime, or unrelated build artifact is included.
- [ ] The change does not overwrite source files or weaken path validation.

## Reporting bugs and proposing features

Use the repository issue forms. A good bug report includes the app version, Windows version, the exact tool, repeatable steps, expected behavior, actual behavior, and a sanitized log or screenshot when available.
