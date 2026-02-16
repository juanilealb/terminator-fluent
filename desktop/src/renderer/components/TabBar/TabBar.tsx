import { useCallback, useRef } from 'react'
import {
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

function getTabTitle(tab: Tab): string {
  if (tab.type === 'terminal') return tab.title
  if (tab.type === 'diff') return 'Changes'
  const name = basenameSafe(toPosixPath(tab.filePath)) || tab.filePath
  return name
}

export function TabBar() {
  const {
    activeTabId,
    setActiveTab,
    removeTab,
    activeWorkspaceTabs,
    createTerminalForActiveWorkspace,
    rightPanelOpen,
    toggleRightPanel,
    lastSavedTabId,
    settings,
    showConfirmDialog,
    dismissConfirmDialog,
  } = useAppStore()
  const tabs = activeWorkspaceTabs()
  const confirmOnClose = settings.confirmOnClose

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
