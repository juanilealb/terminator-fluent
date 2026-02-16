import * as pty from 'node-pty'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { WebContents } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { basenameSafe, debugLog, defaultShellArgsFor, getTempDir, resolveDefaultShellProfile, toPosixPath } from '@shared/platform'
import { type AgentPermissionMode } from '@shared/agent-permissions'

interface PtyInstance {
  process: pty.IPty
  webContents: WebContents
  onExitCallbacks: Array<(exitCode: number) => void>
  cols: number
  rows: number
  workspaceId?: string
  codexPromptBuffer: string
  codexAwaitingAnswer: boolean
}

interface ProcessEntry {
  pid: number
  parentPid?: number
  name: string
  commandLine: string
}

type ProcessSnapshotSource = 'powershell' | 'tasklist' | 'none'

interface ProcessSnapshot {
  at: number
  source: ProcessSnapshotSource
  entries: ProcessEntry[]
}

function execFileUtf8(file: string, args: string[], maxBuffer?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        ...(maxBuffer ? { maxBuffer } : {}),
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      },
    )
  })
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }

    current += char
  }

  fields.push(current)
  return fields.map((field) => field.trim())
}

function parseTasklistOutput(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('INFO:')) continue
    const columns = parseCsvLine(line)
    const pid = Number(columns[1])
    const name = columns[0] ?? ''
    if (!name || Number.isNaN(pid)) continue
    entries.push({
      pid,
      name,
      commandLine: name,
    })
  }
  return entries
}

function parsePowerShellProcessOutput(output: string): ProcessEntry[] {
  const trimmed = output.replace(/^\uFEFF/, '').trim()
  if (!trimmed || trimmed === 'null') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const entries: ProcessEntry[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const pid = Number(rec.ProcessId)
    const parentPidRaw = Number(rec.ParentProcessId)
    const name = typeof rec.Name === 'string' ? rec.Name : ''
    const commandLine = typeof rec.CommandLine === 'string' && rec.CommandLine
      ? rec.CommandLine
      : name

    if (!Number.isFinite(pid) || pid <= 0) continue
    entries.push({
      pid,
      parentPid: Number.isFinite(parentPidRaw) && parentPidRaw > 0 ? parentPidRaw : undefined,
      name,
      commandLine,
    })
  }

  return entries
}

async function readProcessesViaPowerShell(): Promise<ProcessEntry[]> {
  try {
    const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
    const output = await execFileUtf8(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      16 * 1024 * 1024,
    )
    return parsePowerShellProcessOutput(output)
  } catch {
    return []
  }
}

async function readProcessesViaTasklist(): Promise<ProcessEntry[]> {
  try {
    const output = await execFileUtf8('tasklist', ['/FO', 'CSV', '/NH'])
    return parseTasklistOutput(output)
  } catch {
    return []
  }
}

function collectDescendantPids(rootPid: number, entries: ProcessEntry[]): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const entry of entries) {
    if (entry.parentPid === undefined) continue
    const list = childrenByParent.get(entry.parentPid) ?? []
    list.push(entry.pid)
    childrenByParent.set(entry.parentPid, list)
  }

  const descendants = new Set<number>([rootPid])
  const queue = [rootPid]

  while (queue.length > 0) {
    const parent = queue.shift()
    if (parent === undefined) continue
    const children = childrenByParent.get(parent)
    if (!children) continue

    for (const childPid of children) {
      if (descendants.has(childPid)) continue
      descendants.add(childPid)
      queue.push(childPid)
    }
  }

  return descendants
}

function isLikelyCodexCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/)
  if (tokens.length === 0) return false

  const stripQuotes = (token: string): string => token.replace(/^['"]|['"]$/g, '')
  const basenameNoLauncherExt = (token: string): string =>
    basenameSafe(token.toLowerCase()).replace(/\.(exe|cmd|bat|ps1|com)$/, '')

  const firstRaw = stripQuotes(tokens[0] ?? '')
  const secondRaw = stripQuotes(tokens[1] ?? '')
  const first = firstRaw.toLowerCase()

  const isCodexPathToken = (token: string): boolean => {
    if (!token) return false
    const base = basenameSafe(token.toLowerCase())
    const withoutExt = base.replace(/\.(exe|cmd|bat|ps1|com)$/, '')
    return withoutExt === 'codex' || base === 'codex.js' || base.startsWith('codex-')
  }

  if (isCodexPathToken(first)) return true

  const firstBin = basenameNoLauncherExt(firstRaw)
  const nodeOrBun = firstBin === 'node' || firstBin === 'bun'
  if (nodeOrBun && isCodexPathToken(secondRaw)) return true

  const firstPosix = toPosixPath(first)
  return firstPosix.includes('/codex/') && (
    firstPosix.endsWith('/codex') ||
    firstPosix.endsWith('/codex.exe') ||
    firstPosix.endsWith('/codex.cmd')
  )
}

function isLikelyCodexProcess(entry: ProcessEntry): boolean {
  return isLikelyCodexCommand(entry.commandLine) || isLikelyCodexCommand(entry.name)
}

function normalizePermissionMode(value: string | undefined): AgentPermissionMode | undefined {
  if (value === 'full-permissions' || value === 'default') return value
  if (value === 'yolo') return 'default'
  return undefined
}

function buildAgentBootstrapWrite(shellFile: string, mode: AgentPermissionMode | undefined): string | undefined {
  if (mode !== 'full-permissions') return undefined

  const shellName = basenameSafe(shellFile.toLowerCase())
  const isPowerShell = shellName === 'pwsh.exe' || shellName === 'powershell.exe' || shellName === 'pwsh' || shellName === 'powershell'
  if (isPowerShell) {
    return [
      "function global:codex { $cmd = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cmd -and $cmd.Source) { & $cmd.Source --sandbox danger-full-access --ask-for-approval never @args } else { Write-Error 'codex command not found.' } }",
      "function global:claude { $cmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cmd -and $cmd.Source) { & $cmd.Source --dangerously-skip-permissions @args } else { Write-Error 'claude command not found.' } }",
      'Clear-Host',
      '',
    ].join('\r')
  }

  if (shellName === 'cmd.exe' || shellName === 'cmd') {
    return [
      'doskey codex=codex --sandbox danger-full-access --ask-for-approval never $*',
      'doskey claude=claude --dangerously-skip-permissions $*',
      'cls',
      '',
    ].join('\r')
  }

  if (shellName === 'bash' || shellName === 'zsh' || shellName === 'sh') {
    return [
      'codex(){ command codex --sandbox danger-full-access --ask-for-approval never "$@"; }',
      'claude(){ command claude --dangerously-skip-permissions "$@"; }',
      'clear',
      '',
    ].join('\r')
  }

  return undefined
}

function normalizePtyEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...extraEnv,
  }

  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string') normalized[key] = value
  }
  return normalized
}

const ACTIVITY_DIR = join(getTempDir(), 'terminator-fluent-activity')
const CODEX_MARKER_SEGMENT = '.codex.'
const CODEX_WAITING_MARKER_SEGMENT = '.codex-wait.'
const PROCESS_SNAPSHOT_TTL_MS = 1000
const CODEX_MONITOR_INTERVAL_MS = 3000
const PTY_DATA_FLUSH_INTERVAL_MS = 8
const CODEX_PROMPT_BUFFER_MAX = 4096
const CODEX_QUESTION_HEADER_RE = /Question\s+\d+\s*\/\s*\d+/i
const CODEX_QUESTION_UNANSWERED_RE = /\bunanswered\b/i
const CODEX_QUESTION_HINT_RE = /\b(?:enter|return)\b.*\b(?:submit|send)\b.*\banswer\b/i
const CODEX_QUESTION_ALT_HINT_RE = /\b(?:waiting for your input|respond to continue)\b/i

function stripAnsiSequences(data: string): string {
  return data
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP.*?\x1b\\/g, '')
}

export class PtyManager {
  private ptys = new Map<string, PtyInstance>()
  private nextId = 0
  private processSnapshotCache: ProcessSnapshot | null = null
  private codexMonitorTimer: ReturnType<typeof setInterval> | null = null

  create(
    workingDir: string,
    webContents: WebContents,
    shell?: string,
    shellArgs?: string[],
    command?: string[],
    initialWrite?: string,
    extraEnv?: Record<string, string>,
  ): string {
    const id = `pty-${++this.nextId}`

    let file: string
    let args: string[]
    if (command && command.length > 0) {
      file = command[0]
      args = command.slice(1)
    } else {
      if (shell && shell.trim()) {
        file = shell.trim()
      } else {
        file = resolveDefaultShellProfile().shell
      }
      args = shellArgs ?? defaultShellArgsFor(file)
    }

    const useConpty = process.env.TERMINATOR_USE_CONPTY === '1'
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: normalizePtyEnv(extraEnv),
      useConpty,
      conptyInheritCursor: useConpty,
    })

    const instance: PtyInstance = {
      process: proc,
      webContents,
      onExitCallbacks: [],
      cols: 80,
      rows: 24,
      workspaceId: extraEnv?.AGENT_ORCH_WS_ID,
      codexPromptBuffer: '',
      codexAwaitingAnswer: false,
    }

    const permissionMode = normalizePermissionMode(extraEnv?.AGENT_ORCH_PERMISSION_MODE)
    const bootstrapWrite = buildAgentBootstrapWrite(file, permissionMode)
    let pendingWrite = `${bootstrapWrite ?? ''}${initialWrite ?? ''}` || undefined
    const flushInitialWrite = (reason: 'first-output' | 'timer') => {
      if (!pendingWrite) return
      const toWrite = pendingWrite
      pendingWrite = undefined
      try {
        proc.write(toWrite)
        debugLog('PTY initial write sent', { ptyId: id, pid: proc.pid, reason })
      } catch (err) {
        debugLog('PTY initial write failed', { ptyId: id, pid: proc.pid, reason, error: err })
      }
    }

    const initialWriteTimer = pendingWrite
      ? setTimeout(() => flushInitialWrite('timer'), 750)
      : null

    let bufferedOutput = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flushBufferedOutput = () => {
      const toSend = bufferedOutput
      bufferedOutput = ''
      flushTimer = null
      if (!toSend || instance.webContents.isDestroyed()) return
      instance.webContents.send(`${IPC.PTY_DATA}:${id}`, toSend)
    }

    proc.onData((data) => {
      bufferedOutput += data
      if (!flushTimer) {
        flushTimer = setTimeout(flushBufferedOutput, PTY_DATA_FLUSH_INTERVAL_MS)
      }
      void this.handleCodexQuestionPrompt(instance, data).catch((err) => {
        debugLog('Codex prompt handler failed', { ptyId: id, pid: proc.pid, error: err })
      })
      flushInitialWrite('first-output')
    })

    proc.onExit(({ exitCode }) => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flushBufferedOutput()
      if (initialWriteTimer) clearTimeout(initialWriteTimer)
      this.clearCodexWorkspaceActivity(instance.workspaceId, instance.process.pid)
      for (const cb of instance.onExitCallbacks) {
        try {
          cb(exitCode)
        } catch (err) {
          debugLog('PTY exit callback failed', { ptyId: id, pid: proc.pid, error: err })
        }
      }
      this.ptys.delete(id)
      debugLog('PTY exited', { ptyId: id, pid: proc.pid, exitCode })
    })

    this.ptys.set(id, instance)
    debugLog('PTY created', {
      ptyId: id,
      pid: proc.pid,
      shell: file,
      args,
      useConpty,
      workingDir,
      workspaceId: instance.workspaceId ?? null,
      agentPermissionMode: permissionMode ?? null,
    })
    return id
  }

  onExit(ptyId: string, callback: (exitCode: number) => void): void {
    const instance = this.ptys.get(ptyId)
    if (instance) instance.onExitCallbacks.push(callback)
  }

  async write(ptyId: string, data: string): Promise<void> {
    const instance = this.ptys.get(ptyId)
    if (!instance) return
    const isSubmit = /[\r\n]/.test(data)

    if (instance.workspaceId && isSubmit && instance.codexAwaitingAnswer) {
      instance.codexPromptBuffer = ''
      instance.codexAwaitingAnswer = false
      this.clearCodexWorkspaceWaiting(instance.workspaceId, instance.process.pid)
      if (await this.isCodexRunningUnder(instance.process.pid)) {
        this.markCodexWorkspaceActive(instance.workspaceId, instance.process.pid)
      }
    } else if (
      instance.workspaceId
      && isSubmit
      && await this.isCodexRunningUnder(instance.process.pid)
    ) {
      // Codex doesn't expose a prompt-submit hook, so mark the workspace active
      // when Enter is sent while a Codex process is already running in this PTY.
      instance.codexPromptBuffer = ''
      instance.codexAwaitingAnswer = false
      this.markCodexWorkspaceActive(instance.workspaceId, instance.process.pid)
    }

    const CHUNK_SIZE = 512
    if (data.length <= CHUNK_SIZE) {
      instance.process.write(data)
      return
    }

    // Chunked write for large pastes to avoid ConPTY buffer overflow
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE)
      instance.process.write(chunk)
      if (i + CHUNK_SIZE < data.length) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    }
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const instance = this.ptys.get(ptyId)
    if (instance) {
      instance.cols = cols
      instance.rows = rows
      instance.process.resize(cols, rows)
    }
  }

  destroy(ptyId: string): void {
    const instance = this.ptys.get(ptyId)
    if (!instance) return

    this.clearCodexWorkspaceActivity(instance.workspaceId, instance.process.pid)
    debugLog('Destroying PTY', {
      ptyId,
      pid: instance.process.pid,
      workspaceId: instance.workspaceId ?? null,
    })
    try {
      instance.process.kill()
    } catch (err) {
      debugLog('PTY kill failed', { ptyId, pid: instance.process.pid, error: err })
    }
    this.ptys.delete(ptyId)
  }

  /** Return IDs of all live PTY processes */
  list(): string[] {
    return Array.from(this.ptys.keys())
  }

  private async getProcessSnapshot(): Promise<{
    entries: ProcessEntry[]
    source: ProcessSnapshotSource
    cached: boolean
  }> {
    const now = Date.now()
    if (
      this.processSnapshotCache
      && (now - this.processSnapshotCache.at) <= PROCESS_SNAPSHOT_TTL_MS
    ) {
      return {
        entries: this.processSnapshotCache.entries,
        source: this.processSnapshotCache.source,
        cached: true,
      }
    }

    const psEntries = await readProcessesViaPowerShell()
    if (psEntries.length > 0) {
      this.processSnapshotCache = {
        at: now,
        source: 'powershell',
        entries: psEntries,
      }
      return { entries: psEntries, source: 'powershell', cached: false }
    }

    const tasklistEntries = await readProcessesViaTasklist()
    if (tasklistEntries.length > 0) {
      this.processSnapshotCache = {
        at: now,
        source: 'tasklist',
        entries: tasklistEntries,
      }
      return { entries: tasklistEntries, source: 'tasklist', cached: false }
    }

    this.processSnapshotCache = {
      at: now,
      source: 'none',
      entries: [],
    }
    return { entries: [], source: 'none', cached: false }
  }

  private async isCodexRunningUnder(rootPid: number): Promise<boolean> {
    const { entries, source, cached } = await this.getProcessSnapshot()
    if (entries.length === 0) {
      debugLog('Codex process detection', {
        rootPid,
        source,
        cached,
        rootExists: false,
        codexDetected: false,
      })
      return false
    }

    const rootExists = entries.some((entry) => entry.pid === rootPid)
    if (!rootExists) {
      debugLog('Codex process detection', {
        rootPid,
        source,
        cached,
        rootExists: false,
        codexDetected: false,
      })
      return false
    }

    let codexDetected = false
    if (source === 'powershell') {
      const descendants = collectDescendantPids(rootPid, entries)
      codexDetected = entries.some((entry) => descendants.has(entry.pid) && isLikelyCodexProcess(entry))
      debugLog('Codex process detection', {
        rootPid,
        source,
        cached,
        rootExists,
        descendantCount: descendants.size,
        codexDetected,
      })
      return codexDetected
    }

    // tasklist fallback: no parent PID support.
    codexDetected = entries.some((entry) => isLikelyCodexProcess(entry))
    debugLog('Codex process detection', {
      rootPid,
      source,
      cached,
      rootExists,
      codexDetected,
      fallbackGlobalMatch: true,
    })
    return codexDetected
  }

  private codexMarkerPath(workspaceId: string, ptyPid: number): string {
    return join(ACTIVITY_DIR, `${workspaceId}${CODEX_MARKER_SEGMENT}${ptyPid}`)
  }

  private codexWaitingMarkerPath(workspaceId: string, ptyPid: number): string {
    return join(ACTIVITY_DIR, `${workspaceId}${CODEX_WAITING_MARKER_SEGMENT}${ptyPid}`)
  }

  private markCodexWorkspaceActive(workspaceId: string, ptyPid: number): void {
    this.clearCodexWorkspaceWaiting(workspaceId, ptyPid)
    const markerPath = this.codexMarkerPath(workspaceId, ptyPid)
    try {
      mkdirSync(ACTIVITY_DIR, { recursive: true })
      writeFileSync(markerPath, '')
      this.startCodexMonitorIfNeeded()
      debugLog('Codex activity marker set', { workspaceId, ptyPid, markerPath })
    } catch (err) {
      debugLog('Codex activity marker write failed', { workspaceId, ptyPid, markerPath, error: err })
    }
  }

  private markCodexWorkspaceWaiting(workspaceId: string, ptyPid: number): void {
    this.clearCodexWorkspaceRunning(workspaceId, ptyPid)
    const markerPath = this.codexWaitingMarkerPath(workspaceId, ptyPid)
    try {
      mkdirSync(ACTIVITY_DIR, { recursive: true })
      writeFileSync(markerPath, '')
      this.startCodexMonitorIfNeeded()
      debugLog('Codex waiting marker set', { workspaceId, ptyPid, markerPath })
    } catch (err) {
      debugLog('Codex waiting marker write failed', { workspaceId, ptyPid, markerPath, error: err })
    }
  }

  private clearCodexWorkspaceActivity(workspaceId: string | undefined, ptyPid: number): void {
    if (!workspaceId) return
    this.clearCodexWorkspaceRunning(workspaceId, ptyPid)
    this.clearCodexWorkspaceWaiting(workspaceId, ptyPid)
  }

  private clearCodexWorkspaceRunning(workspaceId: string, ptyPid: number): void {
    const markerPath = this.codexMarkerPath(workspaceId, ptyPid)
    this.clearMarker(markerPath, 'Codex activity marker cleared', 'Codex activity marker clear failed', { workspaceId, ptyPid })
  }

  private clearCodexWorkspaceWaiting(workspaceId: string, ptyPid: number): void {
    const markerPath = this.codexWaitingMarkerPath(workspaceId, ptyPid)
    this.clearMarker(markerPath, 'Codex waiting marker cleared', 'Codex waiting marker clear failed', { workspaceId, ptyPid })
  }

  private clearMarker(
    markerPath: string,
    okMessage: string,
    errMessage: string,
    extra: Record<string, unknown>,
  ): void {
    try {
      unlinkSync(markerPath)
      debugLog(okMessage, { ...extra, markerPath })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'ENOENT') {
        debugLog(errMessage, { ...extra, markerPath, error: err })
      }
    }
  }

  private isCodexRunningMarked(workspaceId: string, ptyPid: number): boolean {
    try {
      return existsSync(this.codexMarkerPath(workspaceId, ptyPid))
    } catch {
      return false
    }
  }

  private isCodexWaitingMarked(workspaceId: string, ptyPid: number): boolean {
    try {
      return existsSync(this.codexWaitingMarkerPath(workspaceId, ptyPid))
    } catch {
      return false
    }
  }

  private looksLikeCodexQuestionPrompt(buffer: string): boolean {
    const hasHeader = CODEX_QUESTION_HEADER_RE.test(buffer)
    const hasUnanswered = CODEX_QUESTION_UNANSWERED_RE.test(buffer)
    const hasHint = CODEX_QUESTION_HINT_RE.test(buffer) || CODEX_QUESTION_ALT_HINT_RE.test(buffer)
    return hasHint && (hasHeader || hasUnanswered)
  }

  private async handleCodexQuestionPrompt(instance: PtyInstance, data: string): Promise<void> {
    if (!instance.workspaceId) return
    if (instance.codexAwaitingAnswer) return

    const normalized = stripAnsiSequences(data)
    if (!normalized) return

    instance.codexPromptBuffer = `${instance.codexPromptBuffer}${normalized}`.slice(-CODEX_PROMPT_BUFFER_MAX)
    if (!this.looksLikeCodexQuestionPrompt(instance.codexPromptBuffer)) return

    const wasRunning = this.isCodexRunningMarked(instance.workspaceId, instance.process.pid)
      || await this.isCodexRunningUnder(instance.process.pid)
    if (!wasRunning) return

    // Codex is explicitly waiting on user input: clear spinner activity and
    // surface unread attention via the existing notify channel.
    instance.codexAwaitingAnswer = true
    instance.codexPromptBuffer = ''
    this.markCodexWorkspaceWaiting(instance.workspaceId, instance.process.pid)
    if (!instance.webContents.isDestroyed()) {
      instance.webContents.send(IPC.CLAUDE_NOTIFY_WORKSPACE, {
        workspaceId: instance.workspaceId,
        reason: 'waiting_input',
      })
    }
  }

  /** Update the webContents reference for an existing PTY (e.g. after renderer reload) */
  reattach(ptyId: string, webContents: WebContents): boolean {
    const instance = this.ptys.get(ptyId)
    if (!instance) return false
    instance.webContents = webContents

    // Nudge width to force a terminal redraw after renderer reattach.
    try {
      instance.process.resize(instance.cols + 1, instance.rows)
      instance.process.resize(instance.cols, instance.rows)
    } catch (err) {
      debugLog('PTY reattach redraw failed', { ptyId, pid: instance.process.pid, error: err })
    }
    return true
  }

  private startCodexMonitorIfNeeded(): void {
    if (this.codexMonitorTimer) return
    this.codexMonitorTimer = setInterval(() => {
      void this.checkStaleCodexMarkers()
    }, CODEX_MONITOR_INTERVAL_MS)
  }

  private stopCodexMonitor(): void {
    if (this.codexMonitorTimer) {
      clearInterval(this.codexMonitorTimer)
      this.codexMonitorTimer = null
    }
  }

  private async checkStaleCodexMarkers(): Promise<void> {
    let anyMarked = false
    for (const instance of this.ptys.values()) {
      if (!instance.workspaceId) continue
      const pid = instance.process.pid
      const hasRunning = this.isCodexRunningMarked(instance.workspaceId, pid)
      const hasWaiting = this.isCodexWaitingMarked(instance.workspaceId, pid)
      if (!hasRunning && !hasWaiting) continue
      anyMarked = true

      const isRunning = await this.isCodexRunningUnder(pid)
      if (!isRunning) {
        this.clearCodexWorkspaceActivity(instance.workspaceId, pid)
        instance.codexAwaitingAnswer = false
        instance.codexPromptBuffer = ''
        debugLog('Stale codex marker cleared (process exited)', {
          workspaceId: instance.workspaceId,
          ptyPid: pid,
        })
      }
    }

    if (!anyMarked) {
      this.stopCodexMonitor()
    }
  }

  destroyAll(): void {
    this.stopCodexMonitor()
    for (const [id] of this.ptys) {
      this.destroy(id)
    }
  }
}
