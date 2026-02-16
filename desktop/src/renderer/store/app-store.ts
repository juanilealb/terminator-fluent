import { create } from 'zustand'
import type { AppState, PersistedState, Tab } from './types'
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  DEFAULT_PROJECT_OWNERSHIP,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_TYPE,
  parseProjectOwnership,
  parseAgentPermissionMode,
  isWorkspaceType,
} from './types'

const DEFAULT_PR_LINK_PROVIDER = 'github' as const

function parseShellArgs(raw: string): string[] | undefined {
  const input = raw.trim()
  if (!input) return undefined

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const ch of input) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }

    if (ch === '\\' && quote === '"') {
      escaping = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (escaping) current += '\\'
  if (current) args.push(current)
  return args.length > 0 ? args : undefined
}

function shellOverrides(settings: { defaultShell: string; defaultShellArgs: string }): {
  shell?: string
  args?: string[]
} {
  const shell = settings.defaultShell.trim() || undefined
  const args = parseShellArgs(settings.defaultShellArgs)
  return { shell, args }
}

function basenameFromPath(dirPath: string): string {
  const normalized = dirPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? dirPath
}

function formatUserError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  const invokePrefix = /^Error invoking remote method '[^']+': Error:\s*/i
  return err.message.replace(invokePrefix, '') || fallback
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  workspaces: [],
  tabs: [],
  activeWorkspaceId: null,
  activeTabId: null,
  lastActiveTabByWorkspace: {},
  rightPanelMode: 'files',
  rightPanelOpen: true,
  sidebarCollapsed: false,
  lastSavedTabId: null,
  workspaceDialogProjectId: null,
  settings: { ...DEFAULT_SETTINGS },
  settingsOpen: false,
  confirmDialog: null,
  toasts: [],
  quickOpenVisible: false,
  commandPaletteVisible: false,
  unreadWorkspaceIds: new Set<string>(),
  activeClaudeWorkspaceIds: new Set<string>(),
  waitingClaudeWorkspaceIds: new Set<string>(),
  runningAgentCount: 0,
  waitingAgentCount: 0,
  prStatusMap: new Map(),
  ghAvailability: new Map(),
  ghErrorMap: new Map(),

  addProject: (project) =>
    set((s) => ({
      projects: [
        ...s.projects,
        {
          ...project,
          ownership: parseProjectOwnership(project.ownership ?? s.settings.defaultProjectOwnership),
          prLinkProvider: project.prLinkProvider ?? DEFAULT_PR_LINK_PROVIDER,
        },
      ],
    })),

  removeProject: (id) =>
    set((s) => {
      const removedWsIds = new Set(s.workspaces.filter((w) => w.projectId === id).map((w) => w.id))
      const tabMap = { ...s.lastActiveTabByWorkspace }
      const unreadWorkspaceIds = new Set(
        Array.from(s.unreadWorkspaceIds).filter((wsId) => !removedWsIds.has(wsId)),
      )
      const activeClaudeWorkspaceIds = new Set(
        Array.from(s.activeClaudeWorkspaceIds).filter((wsId) => !removedWsIds.has(wsId)),
      )
      const waitingClaudeWorkspaceIds = new Set(
        Array.from(s.waitingClaudeWorkspaceIds).filter((wsId) => !removedWsIds.has(wsId)),
      )
      for (const wsId of removedWsIds) delete tabMap[wsId]
      return {
        projects: s.projects.filter((p) => p.id !== id),
        workspaces: s.workspaces.filter((w) => w.projectId !== id),
        unreadWorkspaceIds,
        activeClaudeWorkspaceIds,
        waitingClaudeWorkspaceIds,
        runningAgentCount: activeClaudeWorkspaceIds.size,
        waitingAgentCount: waitingClaudeWorkspaceIds.size,
        lastActiveTabByWorkspace: tabMap,
      }
    }),

  addWorkspace: (workspace) =>
    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    })),

  removeWorkspace: (id) =>
    set((s) => {
      const newWorkspaces = s.workspaces.filter((w) => w.id !== id)
      const newTabs = s.tabs.filter((t) => t.workspaceId !== id)
      const newUnread = new Set(s.unreadWorkspaceIds)
      const newActiveClaude = new Set(s.activeClaudeWorkspaceIds)
      const newWaitingClaude = new Set(s.waitingClaudeWorkspaceIds)
      newUnread.delete(id)
      newActiveClaude.delete(id)
      newWaitingClaude.delete(id)
      const tabMap = { ...s.lastActiveTabByWorkspace }
      delete tabMap[id]
      return {
        workspaces: newWorkspaces,
        tabs: newTabs,
        unreadWorkspaceIds: newUnread,
        activeClaudeWorkspaceIds: newActiveClaude,
        waitingClaudeWorkspaceIds: newWaitingClaude,
        runningAgentCount: newActiveClaude.size,
        waitingAgentCount: newWaitingClaude.size,
        lastActiveTabByWorkspace: tabMap,
        activeWorkspaceId:
          s.activeWorkspaceId === id
            ? newWorkspaces[0]?.id ?? null
            : s.activeWorkspaceId,
        activeTabId:
          newTabs.find((t) => t.id === s.activeTabId)
            ? s.activeTabId
            : newTabs[0]?.id ?? null,
      }
    }),

  renameWorkspace: (id, name) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => w.id === id ? { ...w, name } : w),
    })),

  updateWorkspaceBranch: (id, branch) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => w.id === id ? { ...w, branch } : w),
    })),

  updateWorkspaceMemory: (id, memory) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => w.id === id ? { ...w, memory } : w),
    })),

  setActiveWorkspace: (id) =>
    set((s) => {
      // Remember which tab was active in the workspace we're leaving
      const tabMap = { ...s.lastActiveTabByWorkspace }
      if (s.activeWorkspaceId && s.activeTabId) {
        tabMap[s.activeWorkspaceId] = s.activeTabId
      }

      const wsTabs = s.tabs.filter((t) => t.workspaceId === id)
      const newUnread = new Set(s.unreadWorkspaceIds)
      if (id) newUnread.delete(id)

      // Restore remembered tab, falling back to first tab
      const remembered = id ? tabMap[id] : null
      const activeTabId = remembered && wsTabs.some((t) => t.id === remembered)
        ? remembered
        : wsTabs[0]?.id ?? null

      return {
        activeWorkspaceId: id,
        activeTabId,
        lastActiveTabByWorkspace: tabMap,
        unreadWorkspaceIds: newUnread,
      }
    }),

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),

  removeTab: (id) =>
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.id !== id)
      const wasActive = s.activeTabId === id
      const wsTabs = newTabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
      return {
        tabs: newTabs,
        activeTabId: wasActive ? (wsTabs[wsTabs.length - 1]?.id ?? null) : s.activeTabId,
      }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  nextTab: () => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (wsTabs.length <= 1) return
    const idx = wsTabs.findIndex((t) => t.id === s.activeTabId)
    const next = wsTabs[(idx + 1) % wsTabs.length]
    set({ activeTabId: next.id })
  },

  prevTab: () => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (wsTabs.length <= 1) return
    const idx = wsTabs.findIndex((t) => t.id === s.activeTabId)
    const prev = wsTabs[(idx - 1 + wsTabs.length) % wsTabs.length]
    set({ activeTabId: prev.id })
  },

  createTerminalForActiveWorkspace: async () => {
    let s = get()
    let workspaceId = s.activeWorkspaceId
    let ws = workspaceId ? s.workspaces.find((w) => w.id === workspaceId) : undefined

    // Quick-start path: if there's no active workspace, ask for a folder and create one.
    if (!ws) {
      const dirPath = await window.api.app.selectDirectory()
      if (!dirPath) return

      const existingWorkspace = s.workspaces.find((w) => w.worktreePath === dirPath)
      if (existingWorkspace) {
        workspaceId = existingWorkspace.id
        get().setActiveWorkspace(workspaceId)
        ws = existingWorkspace
      } else {
        const normalizedPath = dirPath.replace(/\\/g, '/')
        const pathParts = normalizedPath.split('/').filter(Boolean)
        const baseName = pathParts[pathParts.length - 1] || 'workspace'

        let branch = ''
        try {
          branch = await window.api.git.getCurrentBranch(dirPath)
        } catch {
          // Non-git directories are still valid for ad-hoc terminals.
        }

        let project = s.projects.find((p) => p.repoPath === dirPath)
        if (!project) {
          project = {
            id: crypto.randomUUID(),
            name: baseName,
            repoPath: dirPath,
            ownership: s.settings.defaultProjectOwnership ?? DEFAULT_PROJECT_OWNERSHIP,
          }
          get().addProject(project)
        }

        const newWorkspace = {
          id: crypto.randomUUID(),
          name: `${baseName}-quick`,
          type: DEFAULT_WORKSPACE_TYPE,
          branch: branch || 'local',
          worktreePath: dirPath,
          projectId: project.id,
          agentPermissionMode: DEFAULT_AGENT_PERMISSION_MODE,
          memory: '',
        }
        get().addWorkspace(newWorkspace)
        workspaceId = newWorkspace.id
        ws = newWorkspace
      }

      s = get()
    }

    if (!workspaceId || !ws) return

    const { shell, args } = shellOverrides(s.settings)
    const ptyId = await window.api.pty.create(ws.worktreePath, shell, args, {
      AGENT_ORCH_WS_ID: ws.id,
      AGENT_ORCH_PERMISSION_MODE: ws.agentPermissionMode,
    })
    const wsTabs = s.tabs.filter((t) => t.workspaceId === workspaceId)
    const termCount = wsTabs.filter((t) => t.type === 'terminal').length

    get().addTab({
      id: crypto.randomUUID(),
      workspaceId,
      type: 'terminal',
      title: `Terminal ${termCount + 1}`,
      ptyId,
    })
  },

  openDirectory: async (dirPath) => {
    const validDirPath = await window.api.app.addProjectPath(dirPath)
    if (!validDirPath) return

    const existingWorkspace = get().workspaces.find((w) => w.worktreePath === validDirPath)
    if (existingWorkspace) {
      get().setActiveWorkspace(existingWorkspace.id)
      const latest = get()
      const wsTabs = latest.tabs.filter((t) => t.workspaceId === existingWorkspace.id)
      if (wsTabs.length === 0) {
        await latest.createTerminalForActiveWorkspace()
      } else {
        latest.setActiveTab(wsTabs[wsTabs.length - 1].id)
      }
      return
    }

    const baseName = basenameFromPath(validDirPath) || validDirPath
    let project = get().projects.find((p) => p.repoPath === validDirPath)
    if (!project) {
      const nextSettings = get().settings
      project = {
        id: crypto.randomUUID(),
        name: baseName,
        repoPath: validDirPath,
        ownership: nextSettings.defaultProjectOwnership ?? DEFAULT_PROJECT_OWNERSHIP,
      }
      get().addProject(project)
    }

    const currentState = get()
    let workspace = currentState.workspaces.find(
      (w) => w.projectId === project.id && w.worktreePath === validDirPath
    )
    if (!workspace) {
      let branch = ''
      try {
        branch = await window.api.git.getCurrentBranch(validDirPath)
      } catch {
        // Non-git directories are valid for ad-hoc terminals.
      }

      workspace = {
        id: crypto.randomUUID(),
        name: `${baseName}-quick`,
        type: DEFAULT_WORKSPACE_TYPE,
        branch: branch || 'local',
        worktreePath: validDirPath,
        projectId: project.id,
        agentPermissionMode: DEFAULT_AGENT_PERMISSION_MODE,
        memory: '',
      }
      get().addWorkspace(workspace)
    } else {
      get().setActiveWorkspace(workspace.id)
    }

    const latest = get()
    const workspaceTabs = latest.tabs.filter((t) => t.workspaceId === workspace.id)
    if (workspaceTabs.length === 0) {
      await latest.createTerminalForActiveWorkspace()
      return
    }
    const terminalTab = workspaceTabs.find((t) => t.type === 'terminal')
    latest.setActiveTab((terminalTab ?? workspaceTabs[0]).id)
  },

  closeActiveTab: () => {
    const s = get()
    if (!s.activeTabId) return
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab) return
    const closeTab = () => {
      const latest = get()
      const latestTab = latest.tabs.find((t) => t.id === tab.id)
      if (!latestTab) return
      if (latestTab.type === 'terminal') {
        window.api.pty.destroy(latestTab.ptyId)
      }
      latest.removeTab(latestTab.id)
    }

    if (tab.type === 'file' && tab.unsaved && s.settings.confirmOnClose) {
      get().showConfirmDialog({
        title: 'Unsaved changes',
        message: 'This file has unsaved changes. Close anyway?',
        confirmLabel: 'Close',
        destructive: true,
        onConfirm: () => {
          closeTab()
          get().dismissConfirmDialog()
        },
      })
      return
    }

    closeTab()
  },

  setTabUnsaved: (tabId, unsaved) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.type === 'file' ? { ...t, unsaved } : t
      ),
    })),

  notifyTabSaved: (tabId) => {
    set({ lastSavedTabId: tabId })
    setTimeout(() => {
      if (get().lastSavedTabId === tabId) set({ lastSavedTabId: null })
    }, 1200)
  },

  openFileTab: (filePath) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const existing = s.tabs.find(
      (t) => t.workspaceId === s.activeWorkspaceId && t.type === 'file' && t.filePath === filePath
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'file',
      filePath,
    })
  },

  nextWorkspace: () => {
    const s = get()
    if (s.workspaces.length <= 1) return
    // Build visual order: workspaces grouped by project, matching sidebar display
    const ordered = s.projects.flatMap((p) =>
      s.workspaces.filter((w) => w.projectId === p.id),
    )
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((w) => w.id === s.activeWorkspaceId)
    const next = ordered[(idx + 1) % ordered.length]
    get().setActiveWorkspace(next.id)
  },

  prevWorkspace: () => {
    const s = get()
    if (s.workspaces.length <= 1) return
    const ordered = s.projects.flatMap((p) =>
      s.workspaces.filter((w) => w.projectId === p.id),
    )
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((w) => w.id === s.activeWorkspaceId)
    const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
    get().setActiveWorkspace(prev.id)
  },

  switchToTabByIndex: (index) => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (index >= 0 && index < wsTabs.length) {
      set({ activeTabId: wsTabs[index].id })
    }
  },

  closeAllWorkspaceTabs: () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const closeTabs = () => {
      const latest = get()
      const wsId = latest.activeWorkspaceId
      if (!wsId) return
      const wsTabs = latest.tabs.filter((t) => t.workspaceId === wsId)
      wsTabs.forEach((t) => {
        if (t.type === 'terminal') window.api.pty.destroy(t.ptyId)
      })
      set((state) => ({
        tabs: state.tabs.filter((t) => t.workspaceId !== wsId),
        activeTabId: null,
      }))
    }

    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    const hasUnsaved = wsTabs.some((t) => t.type === 'file' && t.unsaved)
    if (hasUnsaved && s.settings.confirmOnClose) {
      get().showConfirmDialog({
        title: 'Unsaved changes',
        message: 'Close all tabs? Some have unsaved changes.',
        confirmLabel: 'Close all',
        destructive: true,
        onConfirm: () => {
          closeTabs()
          get().dismissConfirmDialog()
        },
      })
      return
    }

    closeTabs()
  },

  focusOrCreateTerminal: async () => {
    const s = get()
    const wsTabs = s.activeWorkspaceId
      ? s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
      : []
    const termTab = wsTabs.find((t) => t.type === 'terminal')
    if (termTab) {
      set({ activeTabId: termTab.id })
    } else {
      await get().createTerminalForActiveWorkspace()
    }
  },

  openWorkspaceDialog: (projectId) => set({ workspaceDialogProjectId: projectId }),

  deleteWorkspace: async (workspaceId) => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const project = s.projects.find((p) => p.id === ws.projectId)

    // Destroy PTYs for this workspace
    s.tabs.filter((t) => t.workspaceId === workspaceId && t.type === 'terminal').forEach((t) => {
      if (t.type === 'terminal') window.api.pty.destroy(t.ptyId)
    })

    // Remove from state immediately so sidebar updates
    get().removeWorkspace(workspaceId)

    // Remove git worktree in background (skip if workspace uses the main repo directly)
    if (project && ws.worktreePath !== project.repoPath) {
      try {
        await window.api.git.removeWorktree(project.repoPath, ws.worktreePath)
      } catch (err) {
        const msg = formatUserError(err, 'Failed to remove worktree')
        get().addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
      }
    }
  },

  updateProject: (id, partial) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    })),

  deleteProject: async (projectId) => {
    const s = get()
    const project = s.projects.find((p) => p.id === projectId)
    if (!project) return
    const projectWorkspaces = s.workspaces.filter((w) => w.projectId === projectId)

    // Destroy PTYs and remove worktrees for all workspaces in this project
    for (const ws of projectWorkspaces) {
      s.tabs.filter((t) => t.workspaceId === ws.id && t.type === 'terminal').forEach((t) => {
        if (t.type === 'terminal') window.api.pty.destroy(t.ptyId)
      })
      if (ws.worktreePath !== project.repoPath) {
        try {
          await window.api.git.removeWorktree(project.repoPath, ws.worktreePath)
        } catch (err) {
          const msg = formatUserError(err, 'Failed to remove worktree')
          get().addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
        }
      }
    }

    get().removeProject(projectId)
  },

  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  showConfirmDialog: (dialog) => set({ confirmDialog: dialog }),

  dismissConfirmDialog: () => set({ confirmDialog: null }),

  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, toast] })),

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  toggleQuickOpen: () => set((s) => ({ quickOpenVisible: !s.quickOpenVisible })),
  closeQuickOpen: () => set({ quickOpenVisible: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteVisible: !s.commandPaletteVisible })),
  openCommandPalette: () => set({ commandPaletteVisible: true }),
  closeCommandPalette: () => set({ commandPaletteVisible: false }),

  markWorkspaceUnread: (workspaceId) =>
    set((s) => {
      if (s.unreadWorkspaceIds.has(workspaceId)) return s
      const newUnread = new Set(s.unreadWorkspaceIds)
      newUnread.add(workspaceId)
      return { unreadWorkspaceIds: newUnread }
    }),

  clearWorkspaceUnread: (workspaceId) =>
    set((s) => {
      if (!s.unreadWorkspaceIds.has(workspaceId)) return s
      const newUnread = new Set(s.unreadWorkspaceIds)
      newUnread.delete(workspaceId)
      return { unreadWorkspaceIds: newUnread }
    }),

  setActiveClaudeWorkspaces: (workspaceIds) =>
    set(() => ({
      activeClaudeWorkspaceIds: new Set(workspaceIds),
      runningAgentCount: workspaceIds.length,
      waitingClaudeWorkspaceIds: new Set(),
      waitingAgentCount: 0,
    })),

  setClaudeActivitySnapshot: (snapshot) =>
    set(() => {
      const waitingAgentCount = Object.values(snapshot.waitingAgentsByWorkspace).reduce(
        (sum, count) => sum + count,
        0,
      )
      return {
        activeClaudeWorkspaceIds: new Set(snapshot.runningWorkspaceIds),
        waitingClaudeWorkspaceIds: new Set(snapshot.waitingWorkspaceIds),
        runningAgentCount: snapshot.runningAgentCount,
        waitingAgentCount,
      }
    }),

  setPrStatuses: (projectId, statuses) =>
    set((s) => {
      const newMap = new Map(s.prStatusMap)
      for (const [branch, info] of Object.entries(statuses)) {
        newMap.set(`${projectId}:${branch}`, info)
      }
      return { prStatusMap: newMap }
    }),

  setGhAvailability: (projectId, available, error) =>
    set((s) => {
      const newAvail = new Map(s.ghAvailability)
      newAvail.set(projectId, available)
      const newErrors = new Map(s.ghErrorMap)
      newErrors.set(projectId, error)
      return { ghAvailability: newAvail, ghErrorMap: newErrors }
    }),

  openDiffTab: (workspaceId) => {
    const s = get()
    const existing = s.tabs.find(
      (t) => t.workspaceId === workspaceId && t.type === 'diff'
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId,
      type: 'diff',
    })
  },

  hydrateState: (data) => {
    const projects = (data.projects ?? []).map((project) => ({
      ...project,
      ownership: parseProjectOwnership(project.ownership),
      prLinkProvider: project.prLinkProvider ?? DEFAULT_PR_LINK_PROVIDER,
    }))
    const workspaces = (data.workspaces ?? []).map((workspace) => ({
      ...workspace,
      type: isWorkspaceType(workspace.type) ? workspace.type : DEFAULT_WORKSPACE_TYPE,
      agentPermissionMode: parseAgentPermissionMode(workspace.agentPermissionMode),
    }))
    const saved = data.activeWorkspaceId
    const settings = data.settings ? { ...DEFAULT_SETTINGS, ...data.settings } : { ...DEFAULT_SETTINGS }
    const activeWorkspaceId = settings.restoreWorkspace
      ? ((saved && workspaces.some((w) => w.id === saved) ? saved : workspaces[0]?.id) ?? null)
      : null
    // Tabs will be reconciled with live PTYs asynchronously after set
    const tabs = data.tabs ?? []
    const activeTabId = data.activeTabId ?? null
    set({
      projects,
      workspaces,
      tabs,
      activeWorkspaceId,
      activeTabId,
      lastActiveTabByWorkspace: data.lastActiveTabByWorkspace ?? {},
      settings,
    })
  },

  activeWorkspaceTabs: () => {
    const s = get()
    return s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
  },

  activeProject: () => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws ? s.projects.find((p) => p.id === ws.projectId) : undefined
  },
}))

// ── State persistence ──

function getPersistedSlice(state: AppState): PersistedState {
  return {
    projects: state.projects,
    workspaces: state.workspaces,
    tabs: state.tabs,
    activeWorkspaceId: state.activeWorkspaceId,
    activeTabId: state.activeTabId,
    lastActiveTabByWorkspace: state.lastActiveTabByWorkspace,
    settings: state.settings,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(state: AppState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    window.api.state.save(getPersistedSlice(state))
  }, 500)
}

// Subscribe to store changes and debounce-save persisted slice
useAppStore.subscribe((state, prevState) => {
  if (
    state.projects !== prevState.projects ||
    state.workspaces !== prevState.workspaces ||
    state.tabs !== prevState.tabs ||
    state.activeTabId !== prevState.activeTabId ||
    state.activeWorkspaceId !== prevState.activeWorkspaceId ||
    state.settings !== prevState.settings
  ) {
    debouncedSave(state)
  }
})

// Flush state to disk synchronously when the window is closing.
// Uses sendSync + writeFileSync so the write completes before the renderer is destroyed.
window.addEventListener('beforeunload', () => {
  if (saveTimer) clearTimeout(saveTimer)
  window.api.state.saveSync(getPersistedSlice(useAppStore.getState()))
})

// Load persisted state on startup
export async function hydrateFromDisk(): Promise<void> {
  try {
    const data = await window.api.state.load()
    if (data) {
      useAppStore.getState().hydrateState(data)
    }
  } catch (err) {
    console.error('Failed to load persisted state:', err)
  }

  // Reconcile persisted terminal tabs against live PTY processes
  try {
    const livePtyIds = new Set(await window.api.pty.list())
    const store = useAppStore.getState()
    const tabs = store.tabs

    if (tabs.length > 0 && livePtyIds.size > 0) {
      // Reattach surviving terminal tabs to the new webContents
      const reattachPromises: Promise<boolean>[] = []
      for (const tab of tabs) {
        if (tab.type === 'terminal' && livePtyIds.has(tab.ptyId)) {
          reattachPromises.push(window.api.pty.reattach(tab.ptyId))
        }
      }
      await Promise.all(reattachPromises)
    }

    // Respawn PTYs for terminal tabs whose process is no longer alive
    const deadTabs = tabs.filter(
      (t): t is Extract<Tab, { type: 'terminal' }> =>
        t.type === 'terminal' && !livePtyIds.has(t.ptyId)
    )
    if (deadTabs.length > 0) {
      const { shell, args } = shellOverrides(store.settings)
      const updatedTabs = [...tabs]
      for (const dead of deadTabs) {
        const ws = store.workspaces.find((w) => w.id === dead.workspaceId)
        if (!ws) continue
        try {
          const newPtyId = await window.api.pty.create(ws.worktreePath, shell, args, {
            AGENT_ORCH_WS_ID: ws.id,
            AGENT_ORCH_PERMISSION_MODE: ws.agentPermissionMode,
          })
          const idx = updatedTabs.findIndex((t) => t.id === dead.id)
          if (idx !== -1) updatedTabs[idx] = { ...dead, ptyId: newPtyId }
        } catch {
          // If respawn fails, drop the tab
          const idx = updatedTabs.findIndex((t) => t.id === dead.id)
          if (idx !== -1) updatedTabs.splice(idx, 1)
        }
      }
      // Drop any terminal tabs whose workspace no longer exists
      const finalTabs = updatedTabs.filter(
        (t) => t.type !== 'terminal' || store.workspaces.some((w) => w.id === t.workspaceId)
      )
      const activeTabId = finalTabs.find((t) => t.id === store.activeTabId)
        ? store.activeTabId
        : (finalTabs.find((t) => t.workspaceId === store.activeWorkspaceId)?.id ?? null)
      useAppStore.setState({ tabs: finalTabs, activeTabId })
    }
  } catch (err) {
    console.error('Failed to reconcile PTY tabs:', err)
  }
}
