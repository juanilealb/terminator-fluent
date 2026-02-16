import { useEffect, useState } from 'react'
import {
  Card,
  Switch,
  Dropdown,
  Option,
  SpinButton,
  Input,
  Textarea,
  Button,
  Body1Strong,
  Caption1,
  Subtitle2,
  Table,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
  TableHeaderCell,
} from '@fluentui/react-components'
import { formatShortcut } from '@shared/platform'
import { SHORTCUT_MAP, type ShortcutBinding } from '@shared/shortcuts'
import { useAppStore } from '../../store/app-store'
import type { PromptTemplate, Settings } from '../../store/types'
import type { ThemePreference } from '@shared/ipc-channels'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './SettingsPanel.module.css'

const SHORTCUTS: Array<{ action: string; binding: ShortcutBinding }> = [
  { action: 'Quick open file', binding: SHORTCUT_MAP.quickOpenFile },
  { action: 'Command palette', binding: SHORTCUT_MAP.commandPalette },
  { action: 'New terminal', binding: SHORTCUT_MAP.newTerminal },
  { action: 'Close tab', binding: SHORTCUT_MAP.closeTab },
  { action: 'Close all tabs', binding: SHORTCUT_MAP.closeAllTabs },
  { action: 'Next tab', binding: SHORTCUT_MAP.nextTab },
  { action: 'Previous tab', binding: SHORTCUT_MAP.previousTab },
  { action: 'Tab 1–9', binding: SHORTCUT_MAP.tabOneToNine },
  { action: 'Next workspace', binding: SHORTCUT_MAP.nextWorkspace },
  { action: 'Previous workspace', binding: SHORTCUT_MAP.previousWorkspace },
  { action: 'New workspace', binding: SHORTCUT_MAP.newWorkspace },
  { action: 'Toggle sidebar', binding: SHORTCUT_MAP.toggleSidebar },
  { action: 'Toggle right panel', binding: SHORTCUT_MAP.toggleRightPanel },
  { action: 'Files panel', binding: SHORTCUT_MAP.filesPanel },
  { action: 'Changes panel', binding: SHORTCUT_MAP.changesPanel },
  { action: 'Focus terminal', binding: SHORTCUT_MAP.focusTerminal },
  { action: 'Increase font size', binding: SHORTCUT_MAP.increaseFontSize },
  { action: 'Decrease font size', binding: SHORTCUT_MAP.decreaseFontSize },
  { action: 'Reset font size', binding: SHORTCUT_MAP.resetFontSize },
  { action: 'Settings', binding: SHORTCUT_MAP.settings },
]

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Follow system' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

function SettingRow({ label, description, children }: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <Body1Strong>{label}</Body1Strong>
        <Caption1 className={styles.settingDescription}>{description}</Caption1>
      </div>
      {children}
    </div>
  )
}

function TemplateEditorRow({
  template,
  onChange,
  onDelete,
}: {
  template: PromptTemplate
  onChange: (partial: Partial<PromptTemplate>) => void
  onDelete: () => void
}) {
  return (
    <Card className={styles.templateCard}>
      <div className={styles.templateCardHeader}>
        <Input
          className={styles.templateNameInput}
          value={template.name}
          onChange={(_, data) => onChange({ name: data.value })}
          placeholder="Template name"
          size="small"
        />
        <Button appearance="subtle" size="small" className={styles.templateDeleteBtn} onClick={onDelete}>
          Delete
        </Button>
      </div>
      <Textarea
        className={styles.templateContentInput}
        value={template.content}
        onChange={(_, data) => onChange({ content: data.value })}
        placeholder="Template text. Mentions: @workspace @branch @path @memory @file:README.md"
        resize="vertical"
        size="small"
      />
    </Card>
  )
}

function ClaudeHooksSection() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.claude.checkHooks().then((result: { installed: boolean }) => {
      setInstalled(result.installed)
    }).catch(() => setInstalled(false))
  }, [])

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api.claude.installHooks()
      setInstalled(true)
    } catch {
      setInstalled(false)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setInstalling(true)
    try {
      await window.api.claude.uninstallHooks()
      setInstalled(false)
    } catch {
      // keep current state
    } finally {
      setInstalling(false)
    }
  }

  return (
    <SettingRow
      label="Claude Code hooks"
      description="Show an unread indicator when Claude Code finishes responding in a workspace"
    >
      {installed === true ? (
        <Button
          appearance="subtle"
          size="small"
          className={styles.dangerBtn}
          onClick={handleUninstall}
          disabled={installing}
        >
          {installing ? 'Removing...' : 'Uninstall'}
        </Button>
      ) : (
        <Button
          appearance="primary"
          size="small"
          onClick={handleInstall}
          disabled={installing || installed === null}
        >
          {installing ? 'Installing...' : 'Install'}
        </Button>
      )}
    </SettingRow>
  )
}

function CodexNotifySection() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.codex.checkNotify().then((result: { installed: boolean }) => {
      setInstalled(result.installed)
    }).catch(() => setInstalled(false))
  }, [])

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api.codex.installNotify()
      setInstalled(true)
    } catch {
      setInstalled(false)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setInstalling(true)
    try {
      await window.api.codex.uninstallNotify()
      setInstalled(false)
    } catch {
      // keep current state
    } finally {
      setInstalling(false)
    }
  }

  return (
    <SettingRow
      label="Codex notify hook"
      description="Show done/unread state for Codex turns and clear active state when a turn completes"
    >
      {installed === true ? (
        <Button
          appearance="subtle"
          size="small"
          className={styles.dangerBtn}
          onClick={handleUninstall}
          disabled={installing}
        >
          {installing ? 'Removing...' : 'Uninstall'}
        </Button>
      ) : (
        <Button
          appearance="primary"
          size="small"
          onClick={handleInstall}
          disabled={installing || installed === null}
        >
          {installing ? 'Installing...' : 'Install'}
        </Button>
      )}
    </SettingRow>
  )
}

const shortcutColumns = [
  { columnKey: 'action', label: 'Action' },
  { columnKey: 'shortcut', label: 'Shortcut' },
]

export function SettingsPanel() {
  const { settings, updateSettings, toggleSettings } = useAppStore()

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    updateSettings({ [key]: value })
  }

  const updateTemplate = (id: string, partial: Partial<PromptTemplate>) => {
    update('promptTemplates', settings.promptTemplates.map((template) =>
      template.id === id ? { ...template, ...partial } : template
    ))
  }

  const addTemplate = () => {
    update('promptTemplates', [
      ...settings.promptTemplates,
      {
        id: crypto.randomUUID(),
        name: 'New template',
        content: '',
      },
    ])
  }

  const removeTemplate = (id: string) => {
    update('promptTemplates', settings.promptTemplates.filter((template) => template.id !== id))
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSettings])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <Tooltip
              label="Back"
              shortcut={formatShortcut(SHORTCUT_MAP.settings.mac, SHORTCUT_MAP.settings.win)}
            >
              <button aria-label="Back to workspace" className={styles.backBtn} onClick={toggleSettings}>&#x2190;</button>
            </Tooltip>
            <Subtitle2>Settings</Subtitle2>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.inner}>
          {/* Appearance */}
          <div className={styles.section}>
            <Caption1 className={styles.sectionLabel}>Appearance</Caption1>
            <Card className={styles.card}>
              <SettingRow
                label="Theme"
                description="Follow Windows theme, or force dark/light mode"
              >
                <Dropdown
                  className={styles.dropdown}
                  value={THEME_OPTIONS.find((o) => o.value === settings.themePreference)?.label ?? 'Follow system'}
                  selectedOptions={[settings.themePreference]}
                  onOptionSelect={(_, data) => update('themePreference', data.optionValue as ThemePreference)}
                  size="small"
                >
                  {THEME_OPTIONS.map((option) => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
              </SettingRow>

              <SettingRow
                label="Terminal font size"
                description="Font size in pixels for terminal tabs"
              >
                <SpinButton
                  className={styles.spinButton}
                  value={settings.terminalFontSize}
                  min={8}
                  max={32}
                  onChange={(_, data) => {
                    if (data.value !== undefined && data.value !== null) {
                      update('terminalFontSize', data.value)
                    }
                  }}
                  size="small"
                />
              </SettingRow>

              <SettingRow
                label="Terminal copy on select"
                description="Automatically copy selected terminal text to clipboard"
              >
                <Switch
                  checked={settings.terminalCopyOnSelect}
                  onChange={(_, data) => update('terminalCopyOnSelect', data.checked)}
                />
              </SettingRow>

              <SettingRow
                label="Editor font size"
                description="Font size in pixels for file and diff editors"
              >
                <SpinButton
                  className={styles.spinButton}
                  value={settings.editorFontSize}
                  min={8}
                  max={32}
                  onChange={(_, data) => {
                    if (data.value !== undefined && data.value !== null) {
                      update('editorFontSize', data.value)
                    }
                  }}
                  size="small"
                />
              </SettingRow>
            </Card>
          </div>

          {/* General */}
          <div className={styles.section}>
            <Caption1 className={styles.sectionLabel}>General</Caption1>
            <Card className={styles.card}>
              <SettingRow
                label="Confirm on close"
                description="Show confirmation when closing tabs with unsaved changes"
              >
                <Switch
                  checked={settings.confirmOnClose}
                  onChange={(_, data) => update('confirmOnClose', data.checked)}
                />
              </SettingRow>

              <SettingRow
                label="Auto-save on blur"
                description="Automatically save files when switching away from a tab"
              >
                <Switch
                  checked={settings.autoSaveOnBlur}
                  onChange={(_, data) => update('autoSaveOnBlur', data.checked)}
                />
              </SettingRow>

              <SettingRow
                label="Restore workspace"
                description="Restore the last active workspace when the app starts"
              >
                <Switch
                  checked={settings.restoreWorkspace}
                  onChange={(_, data) => update('restoreWorkspace', data.checked)}
                />
              </SettingRow>

              <SettingRow
                label="Inline diffs"
                description="Show diffs inline instead of side-by-side"
              >
                <Switch
                  checked={settings.diffInline}
                  onChange={(_, data) => update('diffInline', data.checked)}
                />
              </SettingRow>

              <SettingRow
                label="Default shell"
                description="Path to shell executable (leave empty for system default)"
              >
                <Input
                  className={styles.textInput}
                  value={settings.defaultShell}
                  onChange={(_, data) => update('defaultShell', data.value)}
                  placeholder="e.g., pwsh.exe, powershell.exe, cmd.exe"
                  size="small"
                />
              </SettingRow>

              <SettingRow
                label="Default shell args"
                description="Optional startup arguments for the default shell"
              >
                <Input
                  className={styles.textInput}
                  value={settings.defaultShellArgs}
                  onChange={(_, data) => update('defaultShellArgs', data.value)}
                  placeholder='e.g., -NoLogo or /K "chcp 65001>nul"'
                  size="small"
                />
              </SettingRow>

              <SettingRow
                label="PR link provider"
                description="Set per project in Project Settings (gear icon in the sidebar)."
              >
                <span />
              </SettingRow>
            </Card>
          </div>

          {/* Agent Integrations */}
          <div className={styles.section}>
            <Caption1 className={styles.sectionLabel}>Agent Integrations</Caption1>
            <Card className={styles.card}>
              <ClaudeHooksSection />
              <CodexNotifySection />
            </Card>
          </div>

          {/* Prompt Templates */}
          <div className={styles.section}>
            <Caption1 className={styles.sectionLabel}>Prompt templates</Caption1>
            <Card className={styles.card}>
              <Caption1 className={styles.templateHelp}>
                Reusable prompts for command palette and workspace memory. Mentions:{' '}
                <code>@workspace</code>, <code>@branch</code>, <code>@path</code>, <code>@memory</code>, <code>@file:&lt;relative-path&gt;</code>.
              </Caption1>
              {settings.promptTemplates.map((template) => (
                <TemplateEditorRow
                  key={template.id}
                  template={template}
                  onChange={(partial) => updateTemplate(template.id, partial)}
                  onDelete={() => removeTemplate(template.id)}
                />
              ))}
              <Button
                appearance="primary"
                size="small"
                className={styles.addTemplateBtn}
                onClick={addTemplate}
              >
                Add template
              </Button>
            </Card>
          </div>

          {/* Keyboard Shortcuts */}
          <div className={styles.section}>
            <Caption1 className={styles.sectionLabel}>Keyboard Shortcuts</Caption1>
            <Card className={styles.card}>
              <Table size="small" className={styles.shortcutTable}>
                <TableHeader>
                  <TableRow>
                    {shortcutColumns.map((col) => (
                      <TableHeaderCell key={col.columnKey}>
                        <Caption1>{col.label}</Caption1>
                      </TableHeaderCell>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SHORTCUTS.map((s) => (
                    <TableRow key={s.action}>
                      <TableCell>
                        <Caption1>{s.action}</Caption1>
                      </TableCell>
                      <TableCell>
                        <kbd className={styles.kbd}>{formatShortcut(s.binding.mac, s.binding.win)}</kbd>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
