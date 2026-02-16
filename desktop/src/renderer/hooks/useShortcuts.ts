import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

function quotePathForPaste(path: string): string {
  if (!/\s/.test(path)) return path
  return `"${path.replace(/"/g, '\\"')}"`
}

export function useShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inTerminal = !!target?.closest?.('[class*="terminalInner"]')

      // Shift+Enter handling when terminal is focused.
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && inTerminal) {
        // Write kitty keyboard protocol so CLIs can distinguish Shift+Enter from Enter.
        e.preventDefault()
        e.stopPropagation()
        const s = useAppStore.getState()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab?.type === 'terminal') {
          window.api.pty.write(tab.ptyId, '\x1b[13;2u')
        }
        return
      }

      // Windows terminal line-editing conventions.
      if (inTerminal) {
        if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === 'KeyB') {
          e.preventDefault()
          e.stopPropagation()
          useAppStore.getState().toggleSidebar()
          return
        }
        if (e.ctrlKey && !e.shiftKey && !e.metaKey && e.altKey && e.code === 'KeyB') {
          e.preventDefault()
          e.stopPropagation()
          useAppStore.getState().toggleRightPanel()
          return
        }

        const s = useAppStore.getState()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab?.type === 'terminal') {
          if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(tab.ptyId, '\x1bb') // Alt+B previous word
            return
          }
          if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(tab.ptyId, '\x1bf') // Alt+F next word
            return
          }
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'Home') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(tab.ptyId, '\x01') // Ctrl+A beginning of line
            return
          }
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'End') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(tab.ptyId, '\x05') // Ctrl+E end of line
            return
          }
          if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'Backspace') {
            e.preventDefault()
            e.stopPropagation()
            window.api.pty.write(tab.ptyId, '\x17') // Ctrl+W delete previous word
            return
          }
        }
      }

      const meta = e.ctrlKey
      const shift = e.shiftKey
      const alt = e.altKey
      if (!meta) return

      const store = useAppStore.getState()

      // Stop event from reaching terminal (capture phase).
      function consume() {
        e.preventDefault()
        e.stopPropagation()
      }

      // Avoid hijacking terminal shortcuts while focus is inside terminal.
      // Allow command palette and tab management shortcuts through.
      if (inTerminal) {
        if (shift && !alt && e.key.toLowerCase() === 'p') {
          consume()
          store.toggleCommandPalette()
          return
        }
        // Allow tab management shortcuts through (Ctrl+T, Ctrl+W, Ctrl+1-9, Ctrl+Shift+[/])
        const isTabMgmt =
          (!shift && !alt && (e.key === 't' || e.key === 'w')) ||
          (!shift && !alt && e.key >= '1' && e.key <= '9') ||
          (shift && !alt && (e.key === '[' || e.key === ']')) ||
          (shift && !alt && e.code === 'KeyN') ||
          (shift && !alt && e.code === 'KeyW')
        if (!isTabMgmt) return
      }

      // Quick open: Ctrl+P
      if (!shift && !alt && e.key === 'p') {
        consume()
        store.toggleQuickOpen()
        return
      }
      if (shift && !alt && e.key.toLowerCase() === 'p') {
        consume()
        store.toggleCommandPalette()
        return
      }

      // Tab switching: Ctrl+1-9
      if (!shift && !alt && e.key >= '1' && e.key <= '9') {
        consume()
        store.switchToTabByIndex(parseInt(e.key) - 1)
        return
      }

      // Workspace switching: Ctrl+Shift+Up / Ctrl+Shift+Down
      if (shift && !alt && e.key === 'ArrowUp') {
        consume()
        store.prevWorkspace()
        return
      }
      if (shift && !alt && e.key === 'ArrowDown') {
        consume()
        store.nextWorkspace()
        return
      }

      // Tab management
      if (!shift && !alt && e.key === 't') {
        consume()
        store.createTerminalForActiveWorkspace()
        return
      }
      if (shift && !alt && e.code === 'KeyN') {
        consume()
        store.createTerminalForActiveWorkspace()
        return
      }
      if (!shift && !alt && e.key === 'w') {
        consume()
        store.closeActiveTab()
        return
      }
      if (shift && !alt && e.code === 'KeyW') {
        consume()
        store.closeAllWorkspaceTabs()
        return
      }
      if (shift && !alt && e.key === ']') {
        consume()
        store.nextTab()
        return
      }
      if (shift && !alt && e.key === '[') {
        consume()
        store.prevTab()
        return
      }

      // Panels
      if (!shift && !alt && e.key === 'b') {
        consume()
        store.toggleSidebar()
        return
      }
      if (shift && !alt && e.code === 'KeyB') {
        consume()
        store.toggleSidebar()
        return
      }
      if (!shift && alt && e.code === 'KeyB') {
        consume()
        store.toggleRightPanel()
        return
      }
      if (shift && !alt && e.code === 'KeyE') {
        consume()
        store.setRightPanelMode('files')
        if (!store.rightPanelOpen) store.toggleRightPanel()
        return
      }
      if (shift && !alt && e.code === 'KeyG') {
        consume()
        store.setRightPanelMode('changes')
        if (!store.rightPanelOpen) store.toggleRightPanel()
        return
      }

      // Focus
      if (!shift && !alt && e.key === 'j') {
        consume()
        store.focusOrCreateTerminal()
        return
      }

      // Font size: Ctrl+= / Ctrl+- / Ctrl+0
      if (!shift && !alt && (e.key === '=' || e.key === '-' || e.key === '0')) {
        consume()
        const tab = store.tabs.find((t) => t.id === store.activeTabId)
        const isTerminal = tab?.type === 'terminal'
        const key = isTerminal ? 'terminalFontSize' : 'editorFontSize'
        if (e.key === '0') {
          store.updateSettings({ terminalFontSize: 14, editorFontSize: 13 })
        } else {
          const current = store.settings[key]
          const next = Math.max(8, Math.min(32, current + (e.key === '=' ? 1 : -1)))
          store.updateSettings({ [key]: next })
        }
        return
      }

      // Settings
      if (!shift && !alt && e.key === ',') {
        consume()
        store.toggleSettings()
        return
      }

      // Workspace creation
      if (!shift && !alt && e.key === 'n') {
        consume()
        const project = store.activeProject()
        if (project) {
          store.openWorkspaceDialog(project.id)
        } else if (store.projects.length === 1) {
          store.openWorkspaceDialog(store.projects[0].id)
        }
      }
    }

    // Capture phase runs before terminal handlers on the focused textarea.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // Image paste: terminal textareas ignore clipboard images, so intercept and save to temp file.
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (!target?.closest?.('[class*="terminalInner"]')) return
      if (!e.clipboardData) return

      const hasImage = Array.from(e.clipboardData.items).some(
        (item) => item.type.startsWith('image/')
      )
      if (!hasImage) return

      e.preventDefault()
      e.stopPropagation()

      const filePath = await window.api.clipboard.saveImage()
      if (!filePath) return

      const s = useAppStore.getState()
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      if (tab?.type === 'terminal') {
        window.api.pty.write(tab.ptyId, quotePathForPaste(filePath))
      }
    }

    document.addEventListener('paste', handlePaste, true)
    return () => document.removeEventListener('paste', handlePaste, true)
  }, [])
}
