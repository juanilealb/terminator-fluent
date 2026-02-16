# Terminator for Windows

A Windows desktop app for running multiple AI coding agents in parallel. Each agent gets its own terminal, code editor, and git worktree â€” all in one window.

> **Fork note:** This is a Windows-only fork of [@owengretzinger](https://github.com/owengretzinger), streamlined for a Windows-native experience.

---

## Features

- **Parallel agents** â€” Run separate Claude Code / Codex sessions side-by-side, each in its own isolated workspace
- **Full terminal emulator** â€” `xterm.js` + node-pty with PowerShell/cmd support
- **Monaco code editor** â€” Syntax highlighting, diffs, and file editing
- **Git integration** â€” Staging, committing, branching, and worktree management
- **File tree navigation** â€” Browse project files with git status indicators
- **Hook integration** â€” Claude Code and Codex activity/notification hooks (unread indicators, activity spinners)
- **Keyboard-driven** â€” Quick Open, tab switching, and full shortcut support
- **Command palette** â€” Fuzzy command runner plus slash commands
- **Workspace memory** â€” Persistent notes and reusable prompt context per workspace
- **Prompt templates** â€” Mention-aware templates (`@workspace`, `@branch`, `@file:...`, etc.)
- **Snapshots** â€” Workspace checkpoints backed by git stash metadata

---

## Full Usage Guide

For full app usage with all current features (command palette, workspace memory, prompt templates, snapshots, and quick terminal startup), see:

- `desktop/USAGE.md`

---

## Getting Started

### Prerequisites

- **Windows 10/11**
- **[Bun](https://bun.sh)** (package manager & runtime)
- **[Git](https://git-scm.com/download/win)**
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** and/or **[Codex CLI](https://github.com/openai/codex)** installed

### Install & Run

```bash
# Clone the repo
git clone https://github.com/juanilealb/terminator.git
cd terminator

# Install dependencies
bun run setup

# Start in dev mode
bun run dev
```

### Build & Package

```bash
# Production build
bun run build

# Package as Windows installer (NSIS)
bun run dist:win
```

### Run Tests

```bash
bun run test
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Quick Open file | `Ctrl+P` |
| Command palette | `Ctrl+Shift+P` |
| New terminal | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Next/Previous tab | `Ctrl+Shift+]` / `Ctrl+Shift+[` |
| Jump to tab 1-9 | `Ctrl+1..9` |
| New workspace | `Ctrl+N` |
| Next/Previous workspace | `Ctrl+Shift+â†“` / `Ctrl+Shift+â†‘` |
| Toggle sidebar | `Ctrl+B` |
| Toggle right panel | `Ctrl+Alt+B` |
| Files panel | `Ctrl+Shift+E` |
| Changes panel | `Ctrl+Shift+G` |
| Memory panel | `Ctrl+Shift+M` |
| Preview panel | `Ctrl+Shift+V` |
| Focus terminal | `Ctrl+J` |
| Commit staged changes | `Ctrl+Enter` |
| Settings | `Ctrl+,` |
| Zoom in/out/reset | `Ctrl++` / `Ctrl+-` / `Ctrl+0` |

---

## How It Works

### Workspaces & Worktrees

Each agent workspace is backed by a **git worktree** â€” an isolated checkout of your repo where the agent can make changes without interfering with other agents or your main branch. This means you can:

1. Open a project (any git repo)
2. Create multiple workspaces from it
3. Each workspace gets its own branch, terminal, and file view
4. Agents work in parallel without conflicts

### Agent Integration

Terminator integrates with **Claude Code** and **OpenAI Codex** through:

- **Hook scripts** â€” Node.js scripts that Claude/Codex call to signal activity and completion
- **Unread indicators** â€” Know when an agent finishes or needs attention
- **Activity spinners** â€” See which workspaces have active agent sessions

### Debug Mode

Set `TERMINATOR_DEBUG=1` to enable detailed logging:

```bash
set TERMINATOR_DEBUG=1
bun run dev
```

This logs platform info, PTY lifecycle, hook operations, git status, and path normalization â€” useful for troubleshooting.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Electron 40 |
| UI | React 19 + TypeScript (strict) |
| State | Zustand |
| Editor | Monaco Editor |
| Terminal | xterm.js + node-pty (ConPTY) |
| Build | electron-vite + Bun |
| Packaging | electron-builder (NSIS) |
| Tests | Playwright |

---

## Project Structure

```
terminator/
â”œâ”€â”€ desktop/                    # Electron app
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ main/               # Main process (PTY, git, files, IPC, hooks)
â”‚   â”‚   â”œâ”€â”€ preload/            # Context bridge (window.api)
â”‚   â”‚   â”œâ”€â”€ renderer/           # React UI (components, store, hooks)
â”‚   â”‚   â””â”€â”€ shared/             # Shared utilities (platform, shortcuts, IPC)
â”‚   â”œâ”€â”€ claude-hooks/           # Claude Code hook scripts (.js)
â”‚   â”œâ”€â”€ codex-hooks/            # Codex hook scripts (.js)
â”‚   â”œâ”€â”€ e2e/                    # Playwright end-to-end tests
â”‚   â””â”€â”€ electron-builder.yml    # Windows build/packaging config
â””â”€â”€ landing-page/               # Project website
```

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit with conventional commits (`feat:`, `fix:`, `chore:`)
4. Push and open a PR

---

## Credits

- Original project by [@owengretzinger](https://github.com/owengretzinger)
- Terminator Windows fork by [@Juanilealb](https://github.com/Juanilealb)

---

## License

ISC
