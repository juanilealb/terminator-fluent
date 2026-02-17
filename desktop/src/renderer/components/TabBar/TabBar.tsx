import { useCallback, useRef } from 'react'
import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  TabList,
  Tab as FluentTab,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import { DismissRegular } from '@fluentui/react-icons'
import { basenameSafe, formatShortcut, toPosixPath } from '@shared/platform'
import { SHORTCUT_MAP } from '@shared/shortcuts'
import { useAppStore } from '../../store/app-store'
import type { Tab } from '../../store/types'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './TabBar.module.css'

const TAB_ICONS: Record<Tab['type'], { icon: string; className: string }> = {
  terminal: { icon: '>_', className: styles.terminal },
  file: { icon: '◇', className: styles.file },
  diff: { icon: '±', className: styles.diff },
}

function VSCodeLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.editorLogo}>
      <path fill="#0078d4" d="M17.9 2.3 8 6.9 4.5 3.8 1.8 6.5l3.7 3.4-3.7 3.4 2.7 2.7L8 13l9.9 4.7c.7.3 1.5-.2 1.5-1V3.3c0-.8-.8-1.3-1.5-1Z" />
    </svg>
  )
}

function CursorLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.editorLogo}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#111" />
      <path fill="#fff" d="m7 7 10 5-10 5 2.2-5L7 7Z" />
    </svg>
  )
}

function getTabTitle(tab: Tab): string {
  if (tab.type === 'terminal') return tab.title
  if (tab.type === 'diff') return 'Changes'
  const name = basenameSafe(toPosixPath(tab.filePath)) || tab.filePath
  return name
}

export function TabBar() {
  const {
    activeTabId,
    activeWorkspaceId,
    setActiveTab,
    removeTab,
    activeWorkspaceTabs,
    workspaces,
    tabs: allTabs,
    createTerminalForActiveWorkspace,
    rightPanelOpen,
    toggleRightPanel,
    lastSavedTabId,
    settings,
    addToast,
    showConfirmDialog,
    dismissConfirmDialog,
  } = useAppStore()
  const tabs = activeWorkspaceTabs()
  const confirmOnClose = settings.confirmOnClose
  const activeTab = allTabs.find((tab) => tab.id === activeTabId)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const activeTabWorkspace = activeTab
    ? workspaces.find((workspace) => workspace.id === activeTab.workspaceId)
    : null
  const editorTargetWorkspace = activeTabWorkspace ?? activeWorkspace

  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation()
      e.preventDefault()
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      const closeTab = () => {
        if (tab.type === 'terminal') {
          window.api.pty.destroy(tab.ptyId)
        }
        removeTab(tabId)
      }

      if (tab.type === 'file' && tab.unsaved && confirmOnClose) {
        showConfirmDialog({
          title: 'Unsaved changes',
          message: `"${getTabTitle(tab)}" has unsaved changes. Close anyway?`,
          confirmLabel: 'Close',
          destructive: true,
          onConfirm: () => {
            closeTab()
            dismissConfirmDialog()
          },
        })
        return
      }

      closeTab()
    },
    [tabs, removeTab, confirmOnClose, showConfirmDialog, dismissConfirmDialog]
  )

  const handleTabSelect = useCallback(
    (_event: SelectTabEvent, data: SelectTabData) => {
      setActiveTab(data.value as string)
    },
    [setActiveTab]
  )

  const tabListRef = useRef<HTMLDivElement>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = tabListRef.current
    if (!el) return
    if (el.scrollWidth > el.clientWidth) {
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
  }, [])

  const handleOpenEditor = useCallback(async (editor: 'vscode' | 'cursor') => {
    if (!editorTargetWorkspace?.worktreePath) {
      addToast({ id: crypto.randomUUID(), message: 'Select a workspace first', type: 'info' })
      return
    }

    try {
      const result = editor === 'vscode'
        ? await window.api.app.openInVSCode(editorTargetWorkspace.worktreePath)
        : await window.api.app.openInCursor(editorTargetWorkspace.worktreePath)

      if (result.ok) {
        addToast({
          id: crypto.randomUUID(),
          message: `Opening ${editor === 'vscode' ? 'VS Code' : 'Cursor'}...`,
          type: 'info',
        })
        return
      }

      addToast({
        id: crypto.randomUUID(),
        message: result.error ?? `Could not open ${editor === 'vscode' ? 'VS Code' : 'Cursor'}`,
        type: 'error',
      })
    } catch {
      addToast({
        id: crypto.randomUUID(),
        message: `Could not open ${editor === 'vscode' ? 'VS Code' : 'Cursor'}`,
        type: 'error',
      })
    }
  }, [addToast, editorTargetWorkspace])

  return (
    <div className={styles.tabBar}>
      <div className={styles.leftControls}>
        <Tooltip
          label="New terminal"
          shortcut={formatShortcut(SHORTCUT_MAP.newTerminal.mac, SHORTCUT_MAP.newTerminal.win)}
        >
          <button
            type="button"
            className={`${styles.edgeButton} ${styles.plusButton}`}
            onClick={createTerminalForActiveWorkspace}
            aria-label="New terminal tab"
          >
            <span className={styles.plusGlyph}>+</span>
          </button>
        </Tooltip>
      </div>

      <div ref={tabListRef} className={styles.tabListScroller} onWheel={handleWheel}>
      <TabList
        selectedValue={activeTabId}
        onTabSelect={handleTabSelect}
        appearance="subtle"
        size="small"
        className={styles.tabList}
      >
        {tabs.map((tab) => {
          const { icon, className } = TAB_ICONS[tab.type]
          const isSaved = tab.id === lastSavedTabId
          return (
            <FluentTab
              key={tab.id}
              value={tab.id}
              icon={<span className={`${styles.tabIcon} ${className}`}>{icon}</span>}
              className={styles.tab}
            >
              <span className={styles.tabContent}>
                <span className={`${styles.tabTitle} ${isSaved ? styles.savedFlash : ''}`}>
                  {getTabTitle(tab)}
                </span>
                {tab.type === 'file' && tab.unsaved ? (
                  <span className={styles.unsavedDot} />
                ) : (
                  <Tooltip
                    label="Close tab"
                    shortcut={formatShortcut(SHORTCUT_MAP.closeTab.mac, SHORTCUT_MAP.closeTab.win)}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Close ${getTabTitle(tab)}`}
                      className={styles.closeButton}
                      onClick={(e) => handleClose(e, tab.id)}
                    >
                      <DismissRegular />
                    </button>
                  </Tooltip>
                )}
              </span>
            </FluentTab>
          )
        })}
      </TabList>
      </div>

      <div className={styles.rightControls}>
        <div className={styles.openSplit}>
          <button
            type="button"
            className={styles.openPrimaryButton}
            aria-label="Open in VS Code"
            onClick={() => void handleOpenEditor('vscode')}
          >
            <VSCodeLogo />
            <span className={styles.openLabel}>Open in VS Code</span>
          </button>
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <button
                type="button"
                className={styles.openMenuToggle}
                aria-label="Open editor options"
              >
                <span className={styles.openChevron}>{'\u25be'}</span>
              </button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<VSCodeLogo />} onClick={() => void handleOpenEditor('vscode')}>
                  Open in VS Code
                </MenuItem>
                <MenuItem icon={<CursorLogo />} onClick={() => void handleOpenEditor('cursor')}>
                  Open in Cursor
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>

        <Tooltip
          label={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
          shortcut={formatShortcut(SHORTCUT_MAP.toggleRightPanel.mac, SHORTCUT_MAP.toggleRightPanel.win)}
        >
          <button
            type="button"
            className={`${styles.edgeButton} ${styles.rightEdgeButton}`}
            onClick={toggleRightPanel}
            aria-label={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
          >
            <span className={styles.edgeGlyph}>{rightPanelOpen ? '\u203a' : '\u2039'}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
