const { _electron: electron } = require('@playwright/test')
const { performance } = require('perf_hooks')
const { resolve, join } = require('path')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { execSync } = require('child_process')

function createBenchRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const repoPath = join(root, 'repo')
  const remotePath = join(root, 'remote.git')
  mkdirSync(repoPath, { recursive: true })

  const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' })
  run('git init', repoPath)
  run('git checkout -b main', repoPath)
  writeFileSync(join(repoPath, 'README.md'), '# Bench Repo\n', 'utf8')
  run('git add .', repoPath)
  run('git -c user.name="Bench" -c user.email="bench@example.com" commit -m "initial"', repoPath)
  run(`git init --bare "${remotePath}"`, repoPath)
  run(`git remote add origin "${remotePath}"`, repoPath)
  run('git -c core.hooksPath=/dev/null push -u origin main', repoPath)

  return { root, repoPath }
}

function summarize(values) {
  const arr = [...values].sort((a, b) => a - b)
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  const median = arr.length % 2 === 0
    ? (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2
    : arr[Math.floor(arr.length / 2)]
  const min = arr[0]
  const max = arr[arr.length - 1]
  return {
    n: arr.length,
    mean_ms: Number(mean.toFixed(1)),
    median_ms: Number(median.toFixed(1)),
    min_ms: Number(min.toFixed(1)),
    max_ms: Number(max.toFixed(1)),
  }
}

async function runIteration(appPath, iteration) {
  const { root, repoPath } = createBenchRepo(`terminator-bench-${iteration}`)
  const metrics = {}
  let app
  try {
    const t0 = performance.now()
    app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        APPDATA: root,
        LOCALAPPDATA: root,
        TERMINATOR_PROFILE: `bench-${iteration}`,
      },
    })
    const window = await app.firstWindow({ timeout: 120000 })
    await window.waitForLoadState('domcontentloaded')
    await window.waitForSelector('#root', { timeout: 20000 })
    await window.waitForFunction(() => Boolean(window.__store), null, { timeout: 10000 })
    metrics.startup_ms = performance.now() - t0

    const addProjectStart = performance.now()
    const projectId = await window.evaluate((path) => {
      const store = window.__store.getState()
      const id = crypto.randomUUID()
      store.addProject({ id, name: 'bench', repoPath: path })
      return id
    }, repoPath)
    await window.waitForFunction(
      ({ path }) => window.__store.getState().projects.some((p) => p.repoPath === path),
      { path: repoPath },
      { timeout: 10000 },
    )
    metrics.add_project_ms = performance.now() - addProjectStart

    const coldName = `bench-cold-${Date.now()}-${iteration}`
    const coldBranch = `bench/cold-${Date.now()}-${iteration}`
    const coldStart = performance.now()
    const coldWorktreePath = await window.evaluate(async ({ path, name, branch }) => {
      return await window.api.git.createWorktree(path, name, branch, true)
    }, { path: repoPath, name: coldName, branch: coldBranch })
    metrics.create_worktree_cold_ms = performance.now() - coldStart

    const warmName = `bench-warm-${Date.now()}-${iteration}`
    const warmBranch = `bench/warm-${Date.now()}-${iteration}`
    const warmStart = performance.now()
    await window.evaluate(async ({ path, name, branch }) => {
      return await window.api.git.createWorktree(path, name, branch, true)
    }, { path: repoPath, name: warmName, branch: warmBranch })
    metrics.create_worktree_warm_ms = performance.now() - warmStart

    const workspaceId = await window.evaluate(({ projectId, worktreePath, branch }) => {
      const store = window.__store.getState()
      const wsId = crypto.randomUUID()
      store.addWorkspace({
        id: wsId,
        name: 'bench-ws',
        type: 'feature',
        branch,
        worktreePath,
        projectId,
        agentPermissionMode: 'full-permissions',
      })
      return wsId
    }, { projectId, worktreePath: coldWorktreePath, branch: coldBranch })

    const terminalStart = performance.now()
    await window.evaluate(async (wsId) => {
      const store = window.__store.getState()
      store.setActiveWorkspace(wsId)
      await store.createTerminalForActiveWorkspace()
    }, workspaceId)
    await window.waitForFunction(
      ({ wsId }) => window.__store.getState().tabs.some((t) => t.workspaceId === wsId && t.type === 'terminal'),
      { wsId: workspaceId },
      { timeout: 20000 },
    )
    metrics.create_terminal_ms = performance.now() - terminalStart

    await app.close()
    app = null
  } finally {
    if (app) {
      try { await app.close() } catch {}
    }
    rmSync(root, { recursive: true, force: true })
  }

  return {
    startup_ms: Number(metrics.startup_ms.toFixed(1)),
    add_project_ms: Number(metrics.add_project_ms.toFixed(1)),
    create_worktree_cold_ms: Number(metrics.create_worktree_cold_ms.toFixed(1)),
    create_worktree_warm_ms: Number(metrics.create_worktree_warm_ms.toFixed(1)),
    create_terminal_ms: Number(metrics.create_terminal_ms.toFixed(1)),
  }
}

async function main() {
  const appPathArg = process.argv[2]
  const runs = Number(process.argv[3] ?? '5')
  if (!appPathArg) {
    throw new Error('Usage: node benchmark-electron.js <appPath> [runs]')
  }
  const appPath = resolve(appPathArg)
  const rawRuns = []
  for (let i = 0; i < runs; i += 1) {
    const result = await runIteration(appPath, i + 1)
    rawRuns.push(result)
    console.log(`RUN ${i + 1}: ${JSON.stringify(result)}`)
  }

  const keys = [
    'startup_ms',
    'add_project_ms',
    'create_worktree_cold_ms',
    'create_worktree_warm_ms',
    'create_terminal_ms',
  ]

  const summary = {}
  for (const key of keys) {
    summary[key] = summarize(rawRuns.map((r) => r[key]))
  }

  const payload = { runs, rawRuns, summary }
  console.log(`BENCHMARK_JSON ${JSON.stringify(payload)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
