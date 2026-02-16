# Terminator Usage Guide (Windows)

This guide covers day to day usage of the app, including the new workflow features:

- command palette and slash commands
- workspace memory
- prompt templates with mentions
- git snapshots
- quick terminal start without pre creating a workspace

## 1. Core concepts

- Project: a git repository you add to the sidebar
- Workspace: an isolated working context under a project (usually a git worktree/branch)
- Tab: terminal, file editor, or diff view bound to one workspace

## 2. First run

1. Click `Add project` in the left sidebar.
2. Pick a local repository folder.
3. Click `New workspace` under that project.
4. Open a terminal with `Ctrl+T`.

If you press `Ctrl+T` with no workspace selected, Terminator now asks for a folder and creates a quick workspace automatically.

## 3. Left sidebar

Main actions:

- `Add project`: attach a local repo
- `New workspace`: create a workspace under a project
- `Automations`: open scheduled task management
- `Settings`: app configuration

Workspace actions:

- click workspace: activate it
- double click workspace name: rename it
- delete button: remove workspace and its worktree

Project actions:

- project settings button: configure startup commands
- delete button: remove project and its workspaces

## 4. Center area

### Terminal tabs

- `Ctrl+T`: new terminal tab
- `Ctrl+J`: focus existing terminal in workspace or create one
- `Ctrl+W`: close active tab
- `Ctrl+Shift+W`: close all tabs in active workspace

Windows terminal quality of life:

- `Shift+Enter` sends newline in terminal (instead of submit in many CLIs)
- `Ctrl+Left` and `Ctrl+Right` move by word
- `Home` and `End` go to line start/end
- `Ctrl+Backspace` deletes previous word
- `Ctrl+Shift+C` and `Ctrl+Insert` copy selected text
- `Ctrl+Shift+V` and `Shift+Insert` paste clipboard text
- `Ctrl+F` opens find in terminal scrollback
- Right click opens terminal menu with Copy, Paste, Find, and Clear
- In terminal focus, global shortcuts are suppressed (except `Ctrl+Shift+P`)

### File editor and diff tabs

- Quick open with `Ctrl+P`
- Open diff from Changes panel file rows

## 5. Right panel modes

Use `Ctrl+Alt+B` to show/hide right panel.

### Files (`Ctrl+Shift+E`)

- browse workspace tree
- open files in editor
- git status coloring is visible in tree rows

### Changes (`Ctrl+Shift+G`)

- stage/unstage per file or all files
- discard per file or all unstaged files
- click file path to open diff tab and jump to file
- commit staged files from commit box
- `Ctrl+Enter` commits staged changes

### Memory (`Ctrl+Shift+M`)

- persistent notes per workspace
- quick template insertion into terminal
- snapshot controls

### Preview (`Ctrl+Shift+V`)

- accepts:
  - `3000`
  - `localhost:3000`
  - full `http://...` or `https://...`
- `Open`: save URL
- `Refresh`: reload iframe
- `Browser`: open same URL in external browser

## 6. Command palette

Open with `Ctrl+Shift+P`.

Use it for:

- opening panels
- terminal actions
- settings and quick open
- snapshot actions
- running saved prompt templates

Slash commands:

- `/terminal` or `/t`
- `/terminal-find` or `/find`
- `/terminal-clear` or `/clear`
- `/files`
- `/changes`
- `/memory`
- `/snapshot [label]`
- `/restore-latest`
- `/template <name>`
- `/help`

Examples:

- `/snapshot before-refactor`
- `/template bug triage`

## 7. Prompt templates

Manage templates in `Settings -> Prompt templates`.

Supported mentions:

- `@workspace`
- `@branch`
- `@path`
- `@memory`
- `@date`
- `@file:<relative-path>`

`@file:` injects file content into the prompt (truncated to keep payload manageable).

Templates can be run from:

- Memory panel template buttons
- command palette actions
- `/template <name>` slash command

## 8. Snapshots

Snapshots are lightweight workspace checkpoints stored with git stash metadata.

- create snapshot from Memory panel or `/snapshot`
- restore snapshot from Memory panel or `/restore-latest`
- delete snapshot from Memory panel

Important behavior:

- create does not clean working tree
- restore applies snapshot on top of current files
- this is not a hard reset

## 9. Integrations and hooks

In `Settings -> Agent integrations` you can install:

- Claude Code hooks
- Codex notify hook

These power unread and activity indicators in workspaces.

## 10. Keyboard shortcut summary

- `Ctrl+P`: quick open file
- `Ctrl+Shift+P`: command palette
- `Ctrl+T`: new terminal
- `Ctrl+J`: focus/create terminal
- `Ctrl+W`: close tab
- `Ctrl+Shift+W`: close all tabs in workspace
- `Ctrl+Shift+]` and `Ctrl+Shift+[` : next/previous tab
- `Ctrl+1..9`: jump to tab index
- `Ctrl+Shift+Down` and `Ctrl+Shift+Up`: next/previous workspace
- `Ctrl+N`: new workspace
- `Ctrl+B`: toggle sidebar
- `Ctrl+Alt+B`: toggle right panel
- `Ctrl+Shift+E`: files panel
- `Ctrl+Shift+G`: changes panel
- `Ctrl+Shift+M`: memory panel
- `Ctrl+Enter`: commit staged changes
- `Ctrl+,`: settings
- `Ctrl+=`, `Ctrl+-`, `Ctrl+0`: font controls

Terminal local shortcuts:

- `Ctrl+Shift+C`, `Ctrl+Insert`: copy selection
- `Ctrl+Shift+V`, `Shift+Insert`: paste
- `Ctrl+F`: find in scrollback

## 11. Build and installer

From repo root:

```bash
bun run build
bun run dist:win
```

Installer output:

- `desktop/dist/Terminator Setup <version>.exe`

If you still see an old UI after installing:

1. close the running app
2. install the freshly built `.exe`
3. start Terminator again from the updated install

