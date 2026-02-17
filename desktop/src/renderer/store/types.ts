import type { PrInfo, GithubLookupError } from '@shared/github-types'
import type { AgentActivitySnapshot, ThemePreference } from '@shared/ipc-channels'
import {
  DEFAULT_AGENT_PERMISSION_MODE,
  parseAgentPermissionMode,
  isAgentPermissionMode,
  type AgentPermissionMode,
} from '@shared/agent-permissions'

export interface StartupCommand {
  name: string
  command: string
}

export const PROJECT_OWNERSHIPS = ['personal', 'work'] as const
export type ProjectOwnership = (typeof PROJECT_OWNERSHIPS)[number]
export const DEFAULT_PROJECT_OWNERSHIP: ProjectOwnership = 'personal'

export function parseProjectOwnership(value: unknown): ProjectOwnership {
  return value === 'work' ? 'work' : 'personal'
}

export const WORKSPACE_TYPES = ['bug', 'feature', 'chore', 'refactor', 'docs', 'test', 'spike'] as const
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number]
export const DEFAULT_WORKSPACE_TYPE: WorkspaceType = 'feature'

export function isWorkspaceType(value: unknown): value is WorkspaceType {
  return typeof value === 'string' && WORKSPACE_TYPES.includes(value as WorkspaceType)
}

export interface Project {
  id: string
  name: string
  repoPath: string
  ownership?: ProjectOwnership
  startupCommands?: StartupCommand[]
  prLinkProvider?: PrLinkProvider
}

export interface Workspace {
  id: string
  name: string
  type: WorkspaceType
  branch: string
  worktreePath: string
  projectId: string
  agentPermissionMode: AgentPermissionMode
  memory?: string
}

export {
  DEFAULT_AGENT_PERMISSION_MODE,
  parseAgentPermissionMode,
  isAgentPermissionMode,
  type AgentPermissionMode,
}

export type Tab = {
  id: string
  workspaceId: string
} & (
  | { type: 'terminal'; title: string; ptyId: string }
  | { type: 'file'; filePath: string; unsaved?: boolean }
  | { type: 'diff' }
)

export type RightPanelMode = 'files' | 'changes' | 'memory'

export type PrLinkProvider = 'github' | 'graphite' | 'devinreview'

export interface PromptTemplate {
  id: string
  name: string
  content: string
}

export interface Settings {
  themePreference: ThemePreference
  confirmOnClose: boolean
  autoSaveOnBlur: boolean
  defaultShell: string
  defaultShellArgs: string
  defaultProjectOwnership: ProjectOwnership
  githubPersonalLogin: string
  githubWorkLogin: string
  restoreWorkspace: boolean
  diffInline: boolean
  terminalFontSize: number
  terminalCopyOnSelect: boolean
  editorFontSize: number
  promptTemplates: PromptTemplate[]
}

export const DEFAULT_SETTINGS: Settings = {
  themePreference: 'system',
  confirmOnClose: true,
  autoSaveOnBlur: false,
  defaultShell: '',
  defaultShellArgs: '',
  defaultProjectOwnership: DEFAULT_PROJECT_OWNERSHIP,
  githubPersonalLogin: '',
  githubWorkLogin: '',
  restoreWorkspace: true,
  diffInline: false,
  terminalFontSize: 14,
  terminalCopyOnSelect: false,
  editorFontSize: 13,
  promptTemplates: [
    {
      id: 'template-plan',
      name: 'Plan',
      content: 'Create a practical implementation plan for @workspace on branch @branch. Constraints: keep changes incremental and test after each step.',
    },
    {
      id: 'template-review',
      name: 'Review',
      content: 'Review current changes in @workspace for regressions, risky assumptions, and missing tests. Summarize findings by severity.',
    },
  ],
}

export interface Toast {
  id: string
  message: string
  type: 'error' | 'info' | 'success'
}

export interface ConfirmDialogState {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
}

export interface AppState {
  // Data
  projects: Project[]
  workspaces: Workspace[]
  tabs: Tab[]
  activeWorkspaceId: string | null
  activeTabId: string | null
  lastActiveTabByWorkspace: Record<string, string>
  rightPanelMode: RightPanelMode
  rightPanelOpen: boolean
  sidebarCollapsed: boolean
  lastSavedTabId: string | null
  workspaceDialogProjectId: string | null
  settings: Settings
  settingsOpen: boolean
  confirmDialog: ConfirmDialogState | null
  toasts: Toast[]
  quickOpenVisible: boolean
  commandPaletteVisible: boolean
  unreadWorkspaceIds: Set<string>
  activeClaudeWorkspaceIds: Set<string>
  waitingClaudeWorkspaceIds: Set<string>
  completedClaudeWorkspaceIds: Set<string>
  runningAgentCount: number
  waitingAgentCount: number
  prStatusMap: Map<string, PrInfo | null>
  ghAvailability: Map<string, boolean>
  ghErrorMap: Map<string, GithubLookupError | undefined>

  // Actions
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  addWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  setActiveWorkspace: (id: string | null) => void
  addTab: (tab: Tab) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  toggleRightPanel: () => void
  toggleSidebar: () => void
  nextTab: () => void
  prevTab: () => void
  createTerminalForActiveWorkspace: () => Promise<void>
  openDirectory: (dirPath: string) => Promise<void>
  closeActiveTab: () => void
  setTabUnsaved: (tabId: string, unsaved: boolean) => void
  notifyTabSaved: (tabId: string) => void
  openFileTab: (filePath: string) => void
  openDiffTab: (workspaceId: string) => void
  nextWorkspace: () => void
  prevWorkspace: () => void
  switchToTabByIndex: (index: number) => void
  closeAllWorkspaceTabs: () => void
  focusOrCreateTerminal: () => Promise<void>
  openWorkspaceDialog: (projectId: string | null) => void
  renameWorkspace: (id: string, name: string) => void
  updateWorkspaceBranch: (id: string, branch: string) => void
  updateWorkspaceMemory: (id: string, memory: string) => void
  deleteWorkspace: (workspaceId: string) => Promise<void>
  updateProject: (id: string, partial: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (projectId: string) => Promise<void>
  updateSettings: (partial: Partial<Settings>) => void
  toggleSettings: () => void
  showConfirmDialog: (dialog: ConfirmDialogState) => void
  dismissConfirmDialog: () => void
  addToast: (toast: Toast) => void
  dismissToast: (id: string) => void
  toggleQuickOpen: () => void
  closeQuickOpen: () => void
  toggleCommandPalette: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void

  // Unread indicator actions
  markWorkspaceUnread: (workspaceId: string) => void
  clearWorkspaceUnread: (workspaceId: string) => void

  // Agent activity actions (Claude + Codex)
  setActiveClaudeWorkspaces: (workspaceIds: string[]) => void
  setClaudeActivitySnapshot: (snapshot: AgentActivitySnapshot) => void
  setWorkspaceAgentStatus: (workspaceId: string, status: 'running' | 'waiting' | 'completed' | 'idle') => void

  // PR status actions
  setPrStatuses: (projectId: string, statuses: Record<string, PrInfo | null>) => void
  setGhAvailability: (projectId: string, available: boolean, error?: GithubLookupError) => void

  // Hydration
  hydrateState: (data: PersistedState) => void

  // Derived
  activeWorkspaceTabs: () => Tab[]
  activeProject: () => Project | undefined
}

export interface PersistedState {
  projects: Project[]
  workspaces: Workspace[]
  tabs?: Tab[]
  activeWorkspaceId?: string | null
  activeTabId?: string | null
  lastActiveTabByWorkspace?: Record<string, string>
  settings?: Settings
}
