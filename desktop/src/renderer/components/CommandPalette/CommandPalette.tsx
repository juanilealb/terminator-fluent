import { Fragment, useEffect, useMemo, useState } from 'react'
import { Input, Badge, Caption1 } from '@fluentui/react-components'
import { SearchRegular } from '@fluentui/react-icons'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useAppStore } from '../../store/app-store'
import type { Tab } from '../../store/types'
import { dispatchTerminalUiAction, type TerminalUiAction } from '../../utils/terminal-actions'
import { expandPromptTemplate } from '../../utils/prompt-template'
import styles from './CommandPalette.module.css'

interface CommandAction {
  id: string
  title: string
  description: string
  keywords: string[]
  category: string
  shortcut?: string
  run: () => Promise<void> | void
}

type TerminalTab = Extract<Tab, { type: 'terminal' }>

function scoreCommand(query: string, action: CommandAction): number {
  if (!query) return 0
  const haystack = `${action.title} ${action.description} ${action.keywords.join(' ')}`.toLowerCase()
  const q = query.toLowerCase()
  if (haystack.startsWith(q)) return 0
  if (haystack.includes(q)) return 1
  return 999
}

export function CommandPalette() {
  const panelRef = useFocusTrap<HTMLDivElement>()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const {
    workspaces,
    activeWorkspaceId,
    rightPanelOpen,
    settings,
    tabs,
    activeTabId,
    setActiveWorkspace,
    setActiveTab,
    setRightPanelMode,
    toggleRightPanel,
    toggleSidebar,
    createTerminalForActiveWorkspace,
    focusOrCreateTerminal,
    openWorkspaceDialog,
    activeProject,
    toggleSettings,
    toggleQuickOpen,
    addToast,
    closeCommandPalette,
  } = useAppStore()

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)

  const ensureRightPanelMode = (mode: 'files' | 'changes') => {
    setRightPanelMode(mode)
    if (!rightPanelOpen) toggleRightPanel()
  }

  const triggerTerminalAction = (action: TerminalUiAction): boolean => {
    let terminalTab = tabs.find((t): t is TerminalTab => t.id === activeTabId && t.type === 'terminal')

    if (!terminalTab && workspace) {
      terminalTab = tabs.find((t): t is TerminalTab => t.type === 'terminal' && t.workspaceId === workspace.id)
      if (terminalTab) setActiveTab(terminalTab.id)
    }

    if (!terminalTab) {
      addToast({ id: crypto.randomUUID(), message: 'No terminal available', type: 'info' })
      return false
    }

    dispatchTerminalUiAction(terminalTab.ptyId, action)
    return true
  }

  const insertTemplateIntoTerminal = async (templateContent: string, templateName: string) => {
    const expanded = await expandPromptTemplate(templateContent, workspace)
    let terminalTab = tabs.find((t): t is TerminalTab => t.id === activeTabId && t.type === 'terminal')

    if (!terminalTab || (workspace && terminalTab.workspaceId !== workspace.id)) {
      const workspaceTerminal = workspace
        ? tabs.find((t): t is TerminalTab => t.type === 'terminal' && t.workspaceId === workspace.id)
        : undefined
      if (workspaceTerminal) {
        terminalTab = workspaceTerminal
      } else {
        if (workspace) setActiveWorkspace(workspace.id)
        await createTerminalForActiveWorkspace()
        const latest = useAppStore.getState()
        const created = latest.tabs.find((t) => t.id === latest.activeTabId)
        terminalTab = created?.type === 'terminal' ? created : undefined
      }
    }

    if (!terminalTab) {
      addToast({ id: crypto.randomUUID(), message: 'No terminal available for template insertion', type: 'error' })
      return
    }

    window.api.pty.write(terminalTab.ptyId, expanded)
    addToast({
      id: crypto.randomUUID(),
      message: `Template "${templateName}" inserted into terminal`,
      type: 'info',
    })
  }

  const actionList = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      {
        id: 'new-terminal',
        title: 'New terminal',
        description: 'Open a terminal in the active workspace or quick-start from a folder',
        keywords: ['terminal', '/terminal', '/t', 'quick'],
        category: 'Terminal',
        shortcut: '/t',
        run: async () => createTerminalForActiveWorkspace(),
      },
      {
        id: 'focus-terminal',
        title: 'Focus terminal',
        description: 'Focus first terminal tab or create one',
        keywords: ['terminal', 'focus', '/focus'],
        category: 'Terminal',
        run: async () => focusOrCreateTerminal(),
      },
      {
        id: 'find-terminal',
        title: 'Find in terminal',
        description: 'Search text in the active terminal scrollback',
        keywords: ['terminal', 'find', '/terminal-find'],
        category: 'Terminal',
        shortcut: '/find',
        run: () => {
          triggerTerminalAction('find')
        },
      },
      {
        id: 'clear-terminal',
        title: 'Clear terminal',
        description: 'Clear active terminal viewport and scrollback',
        keywords: ['terminal', 'clear', '/terminal-clear'],
        category: 'Terminal',
        shortcut: '/clear',
        run: () => {
          triggerTerminalAction('clear')
        },
      },
      {
        id: 'quick-open',
        title: 'Quick open file',
        description: 'Open file picker for the active workspace',
        keywords: ['file', 'open', '/open'],
        category: 'Navigation',
        run: () => toggleQuickOpen(),
      },
      {
        id: 'open-settings',
        title: 'Open settings',
        description: 'Toggle settings panel',
        keywords: ['settings', 'preferences', '/settings'],
        category: 'Navigation',
        run: () => toggleSettings(),
      },
      {
        id: 'new-workspace',
        title: 'New workspace',
        description: 'Open create workspace dialog',
        keywords: ['workspace', '/workspace'],
        category: 'Navigation',
        run: () => {
          const project = activeProject()
          if (project) {
            openWorkspaceDialog(project.id)
            return
          }
          if (useAppStore.getState().projects.length === 1) {
            openWorkspaceDialog(useAppStore.getState().projects[0].id)
            return
          }
          addToast({ id: crypto.randomUUID(), message: 'Select a project first', type: 'info' })
        },
      },
      {
        id: 'toggle-sidebar',
        title: 'Toggle sidebar',
        description: 'Show or hide project/workspace sidebar',
        keywords: ['sidebar', '/sidebar'],
        category: 'Navigation',
        run: () => toggleSidebar(),
      },
      {
        id: 'panel-files',
        title: 'Show files panel',
        description: 'Open right panel in Files mode',
        keywords: ['files', '/files'],
        category: 'Panels',
        shortcut: '/files',
        run: () => ensureRightPanelMode('files'),
      },
      {
        id: 'panel-changes',
        title: 'Show changes panel',
        description: 'Open right panel in Changes mode',
        keywords: ['changes', '/changes', 'git'],
        category: 'Panels',
        shortcut: '/changes',
        run: () => ensureRightPanelMode('changes'),
      },
    ]

    if (workspace) {
      actions.push({
        id: 'snapshot-create',
        title: 'Create snapshot',
        description: 'Save current workspace state without cleaning working tree',
        keywords: ['snapshot', '/snapshot', 'stash'],
        category: 'Workspace',
        shortcut: '/snapshot',
        run: async () => {
          const created = await window.api.git.createSnapshot(workspace.worktreePath, 'Snapshot')
          if (!created) {
            addToast({ id: crypto.randomUUID(), message: 'No local changes to snapshot', type: 'info' })
            return
          }
          addToast({ id: crypto.randomUUID(), message: `Snapshot created: ${created.label}`, type: 'info' })
        },
      })
      actions.push({
        id: 'snapshot-restore-latest',
        title: 'Restore latest snapshot',
        description: 'Apply the latest snapshot on top of current files',
        keywords: ['snapshot', 'restore', '/restore-latest'],
        category: 'Workspace',
        shortcut: '/restore-latest',
        run: async () => {
          const snapshots = await window.api.git.listSnapshots(workspace.worktreePath)
          const latest = snapshots[0]
          if (!latest) {
            addToast({ id: crypto.randomUUID(), message: 'No snapshots available', type: 'info' })
            return
          }
          await window.api.git.restoreSnapshot(workspace.worktreePath, latest.ref)
          addToast({ id: crypto.randomUUID(), message: `Snapshot restored: ${latest.label}`, type: 'info' })
        },
      })
    }

    for (const template of settings.promptTemplates) {
      actions.push({
        id: `template-${template.id}`,
        title: `Run template: ${template.name}`,
        description: 'Expand mentions and insert into terminal',
        keywords: ['template', '/template', template.name.toLowerCase()],
        category: 'Templates',
        shortcut: '/template',
        run: async () => {
          await insertTemplateIntoTerminal(template.content, template.name)
        },
      })
    }

    return actions
  }, [
    workspace,
    settings.promptTemplates,
    activeProject,
    createTerminalForActiveWorkspace,
    focusOrCreateTerminal,
    toggleQuickOpen,
    toggleSettings,
    toggleSidebar,
    openWorkspaceDialog,
    addToast,
    setActiveWorkspace,
    tabs,
    activeTabId,
    rightPanelOpen,
  ])

  const filtered = useMemo(() => {
    const trimmed = query.trim()
    const ranked = actionList
      .map((action) => ({ action, score: scoreCommand(trimmed, action) }))
      .filter((entry) => entry.score < 999)
      .sort((a, b) => a.score - b.score || a.action.title.localeCompare(b.action.title))
      .map((entry) => entry.action)
    return ranked.slice(0, 24)
  }, [actionList, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const executeSlashCommand = async (): Promise<boolean> => {
    const trimmed = query.trim()
    if (!trimmed.startsWith('/')) return false

    const body = trimmed.slice(1)
    const [commandRaw, ...rest] = body.split(/\s+/)
    const command = commandRaw.toLowerCase()
    const arg = rest.join(' ').trim()

    if (command === 'terminal' || command === 't') {
      await createTerminalForActiveWorkspace()
      return true
    }
    if (command === 'files') {
      ensureRightPanelMode('files')
      return true
    }
    if (command === 'terminal-find' || command === 'find') {
      triggerTerminalAction('find')
      return true
    }
    if (command === 'terminal-clear' || command === 'clear') {
      triggerTerminalAction('clear')
      return true
    }
    if (command === 'changes') {
      ensureRightPanelMode('changes')
      return true
    }
    if (command === 'snapshot') {
      if (!workspace) {
        addToast({ id: crypto.randomUUID(), message: 'Select a workspace first', type: 'info' })
        return true
      }
      const created = await window.api.git.createSnapshot(workspace.worktreePath, arg || 'Snapshot')
      if (!created) {
        addToast({ id: crypto.randomUUID(), message: 'No local changes to snapshot', type: 'info' })
        return true
      }
      addToast({ id: crypto.randomUUID(), message: `Snapshot created: ${created.label}`, type: 'info' })
      return true
    }
    if (command === 'restore-latest') {
      if (!workspace) {
        addToast({ id: crypto.randomUUID(), message: 'Select a workspace first', type: 'info' })
        return true
      }
      const snapshots = await window.api.git.listSnapshots(workspace.worktreePath)
      const latest = snapshots[0]
      if (!latest) {
        addToast({ id: crypto.randomUUID(), message: 'No snapshots available', type: 'info' })
        return true
      }
      await window.api.git.restoreSnapshot(workspace.worktreePath, latest.ref)
      addToast({ id: crypto.randomUUID(), message: `Snapshot restored: ${latest.label}`, type: 'info' })
      return true
    }
    if (command === 'template') {
      if (!arg) {
        addToast({ id: crypto.randomUUID(), message: 'Usage: /template <name>', type: 'info' })
        return true
      }
      const template = settings.promptTemplates.find((t) => t.name.toLowerCase().includes(arg.toLowerCase()))
      if (!template) {
        addToast({ id: crypto.randomUUID(), message: `Template "${arg}" not found`, type: 'error' })
        return true
      }
      await insertTemplateIntoTerminal(template.content, template.name)
      return true
    }
    if (command === 'help') {
        addToast({
          id: crypto.randomUUID(),
          message: 'Slash commands: /terminal /terminal-find /terminal-clear /files /changes /snapshot /restore-latest /template',
          type: 'info',
        })
      return true
    }

    return false
  }

  const executeSelected = async () => {
    if (await executeSlashCommand()) {
      closeCommandPalette()
      return
    }
    const action = filtered[selectedIndex]
    if (!action) return
    await action.run()
    closeCommandPalette()
  }

  const showCategories = !query.trim()

  return (
    <div className={styles.overlay} onClick={closeCommandPalette}>
      <div
        ref={panelRef}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
      >
        <div className={styles.inputWrap}>
          <Input
            contentBefore={<SearchRegular />}
            appearance="filled-darker"
            size="large"
            className={styles.searchInput}
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeCommandPalette()
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (filtered.length > 0) setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (filtered.length > 0) setSelectedIndex((i) => Math.max(i - 1, 0))
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                await executeSelected()
              }
            }}
            placeholder="Type a command, or use /slash commands"
            autoFocus
          />
        </div>
        <div className={styles.results}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No matching commands</div>
          ) : (
            filtered.map((action, index) => {
              const prevCategory = index > 0 ? filtered[index - 1].category : null
              const showHeader = showCategories && action.category !== prevCategory
              return (
                <Fragment key={action.id}>
                  {showHeader && (
                    <Caption1 className={styles.categoryLabel}>{action.category}</Caption1>
                  )}
                  <button
                    className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={async () => {
                      setSelectedIndex(index)
                      await action.run()
                      closeCommandPalette()
                    }}
                  >
                    <div className={styles.resultRow}>
                      <span className={styles.resultTitle}>{action.title}</span>
                      {action.shortcut && (
                        <Badge appearance="outline" size="small" className={styles.shortcutBadge}>
                          {action.shortcut}
                        </Badge>
                      )}
                    </div>
                    <span className={styles.resultDescription}>{action.description}</span>
                  </button>
                </Fragment>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
