import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Divider } from "@fluentui/react-components";
import { basenameSafe, formatShortcut, toPosixPath } from "@shared/platform";
import { SHORTCUT_MAP } from "@shared/shortcuts";
import { DEFAULT_AGENT_PERMISSION_MODE, type AgentPermissionMode } from "@shared/agent-permissions";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_WORKSPACE_TYPE, type Project, type PrLinkProvider, type WorkspaceType } from "../../store/types";
import type { CreateWorktreeProgressEvent } from "../../../shared/workspace-creation";
import type { OpenPrInfo, GithubLookupError } from "../../../shared/github-types";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "../Tooltip/Tooltip";
import styles from "./Sidebar.module.css";

const PR_ICON_SIZE = 10;
const PR_REVIEW_ICON_SIZE = 10;
const START_TERMINAL_MESSAGE = "Starting terminal...";
const MAX_COMMENT_COUNT_DISPLAY = 9;
const PR_PROVIDER_DOMAINS: Record<PrLinkProvider, string> = {
  github: "github.com",
  graphite: "graphite.dev",
  devinreview: "devinreview.com",
};

function providerUrl(url: string, provider: PrLinkProvider): string {
  return url.replace("github.com", PR_PROVIDER_DOMAINS[provider]);
}

function sanitizeBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/[\x00-\x1f\x7f~^:?*[\]\\]/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\/\./g, "/-")
    .replace(/@\{/g, "-")
    .replace(/\.lock(\/|$)/g, "-lock$1")
    .replace(/^[.\-/]+/, "")
    .replace(/[.\-/]+$/, "");
}

function slugifyWorkspaceName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildPrWorkspaceName(pr: OpenPrInfo): string {
  const slug = slugifyWorkspaceName(pr.title);
  return slug || `pr-${pr.number}`;
}

function buildPrLocalBranch(pr: OpenPrInfo): string {
  const head = sanitizeBranchName(pr.headRefName) || `pr-${pr.number}`;
  const branch = sanitizeBranchName(`pr/${pr.number}-${head}`);
  return branch || `pr/${pr.number}`;
}

function uniqueWorkspaceName(
  baseName: string,
  projectId: string,
  workspaces: Array<{ projectId: string; name: string }>,
): string {
  const normalized = baseName.trim() || "workspace";
  const used = new Set(
    workspaces
      .filter((ws) => ws.projectId === projectId)
      .map((ws) => ws.name.toLowerCase()),
  );
  if (!used.has(normalized.toLowerCase())) return normalized;

  let suffix = 2;
  while (used.has(`${normalized}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${normalized}-${suffix}`;
}

function githubErrorMessage(error?: GithubLookupError): string {
  if (error === "gh_not_installed") return "GitHub CLI is not installed.";
  if (error === "not_authenticated") return "GitHub CLI is not authenticated.";
  if (error === "not_github_repo") return "Origin remote is not a GitHub repo.";
  return "Failed to load open pull requests.";
}

function extractPrNumberFromBranch(branch: string): number | null {
  const patterns = [
    /(?:^|\/)pr[/-](\d+)(?:[-/]|$)/i,
    /(?:^|\/)pull[/-](\d+)(?:[-/]|$)/i,
    /#(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = branch.match(pattern);
    if (!match?.[1]) continue;
    const number = Number.parseInt(match[1], 10);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function ghStatusHintMessage(error?: GithubLookupError): string | null {
  if (error === "gh_not_installed") return "Install GitHub CLI (gh) to show PR status";
  if (error === "not_authenticated") return "Run \u201Cgh auth login\u201D to show PR status";
  if (error === "not_github_repo") return null; // not worth showing
  return null;
}

function GhStatusHint({ projectId }: { projectId: string }) {
  const ghAvailable = useAppStore((s) => s.ghAvailability.get(projectId));
  const ghError = useAppStore((s) => s.ghErrorMap.get(projectId));

  // Don't show anything if we haven't checked yet or gh is available
  if (ghAvailable === undefined || ghAvailable === true) return null;

  const message = ghStatusHintMessage(ghError);
  if (!message) return null;

  return (
    <div className={styles.ghStatusHint} title={message}>
      <span className={styles.ghStatusHintIcon}>&#x26A0;</span>
      <span className={styles.ghStatusHintText}>{message}</span>
    </div>
  );
}

interface WorkspaceCreationState {
  requestId: string;
  message: string;
}

function PrStateIcon({ state }: { state: "open" | "merged" | "closed" }) {
  if (state === "open") {
    return (
      <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
    );
  }
  if (state === "merged") {
    return (
      <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
      </svg>
    );
  }
  return (
    <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.75.75 0 1 1 1.06 1.06l-.97.97.97.97a.75.75 0 0 1-1.06 1.06l-.97-.97-.97.97a.75.75 0 1 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function CommentCountIcon({ count }: { count: number }) {
  const text =
    count > MAX_COMMENT_COUNT_DISPLAY
      ? `${MAX_COMMENT_COUNT_DISPLAY}+`
      : String(count);
  return (
    <span className={styles.prCommentIcon}>
      <svg
        className={styles.prCommentIconBubble}
        width="18"
        height="14"
        viewBox="0 0 18 14"
        aria-hidden="true"
      >
        <path d="M2.25 2.75C2.25 1.784 3.034 1 4 1h10c.966 0 1.75.784 1.75 1.75v6.5c0 .966-.784 1.75-1.75 1.75H9L5.5 13V11H4c-.966 0-1.75-.784-1.75-1.75Z" />
      </svg>
      <span className={styles.prCommentIconCount}>{text}</span>
    </span>
  );
}

function PrReviewDecisionIcon({
  decision,
}: {
  decision: "approved" | "changes_requested";
}) {
  if (decision === "approved") {
    return (
      <svg width={PR_REVIEW_ICON_SIZE} height={PR_REVIEW_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z" />
      </svg>
    );
  }

  return (
    <svg width={PR_REVIEW_ICON_SIZE} height={PR_REVIEW_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.78 2.97a.75.75 0 0 1 0 1.06L4.81 6H9.5A4.5 4.5 0 0 1 14 10.5v1.75a.75.75 0 0 1-1.5 0V10.5A3 3 0 0 0 9.5 7.5H4.81l1.97 1.97a.75.75 0 1 1-1.06 1.06L2.47 7.28a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function WorkspaceMeta({
  projectId,
  branch,
  showBranch,
}: {
  projectId: string;
  branch: string;
  showBranch: boolean;
}) {
  const prInfo = useAppStore((s) =>
    s.prStatusMap.get(`${projectId}:${branch}`),
  );
  const ghAvailable = useAppStore((s) => s.ghAvailability.get(projectId));
  const prLinkProvider = useAppStore(
    (s) => s.projects.find((p) => p.id === projectId)?.prLinkProvider ?? "github",
  );
  const hasPr = !!(ghAvailable && prInfo !== undefined && prInfo !== null);
  const inferredPrNumber = hasPr ? null : extractPrNumberFromBranch(branch);
  const hasInferredPr = inferredPrNumber !== null;
  const normalizedBranch = branch.trim();

  if (!hasPr && !hasInferredPr && !showBranch) return null;

  const stateClass = hasPr ? styles[`pr_${prInfo!.state}`] || "" : "";
  const openPr = hasPr && prInfo!.state === "open";
  const pendingCommentCount = openPr ? Math.max(0, prInfo!.pendingCommentCount || 0) : 0;
  const hasPendingComments = pendingCommentCount > 0;
  const isCiPending = openPr && prInfo!.checkStatus === "pending";
  const isBlockedByCi = openPr && prInfo!.checkStatus === "failing";
  const isApproved = openPr && !!prInfo!.isApproved;
  const isCiPassing = openPr && prInfo!.checkStatus === "passing";
  const isChangesRequested = openPr && !!prInfo!.isChangesRequested;
  const reviewDecision: "approved" | "changes_requested" | null = isChangesRequested
    ? "changes_requested"
    : isApproved
      ? "approved"
      : null;

  return (
    <span className={styles.workspaceMeta}>
      {hasPr && (
        <span
          className={`${styles.prInline} ${stateClass}`}
          title={`PR #${prInfo!.number}: ${prInfo!.title}`}
          onClick={(e) => {
            e.stopPropagation();
            window.open(providerUrl(prInfo!.url, prLinkProvider));
          }}
        >
          <PrStateIcon state={prInfo!.state} />
          <span className={styles.prNumber}>#{prInfo!.number}</span>
          {openPr && reviewDecision && (
            <span
              className={`${styles.prReviewDecisionIcon} ${styles.prReviewDecisionInline} ${
                reviewDecision === "approved" ? styles.prApproved : styles.prChangesRequested
              }`}
              title={reviewDecision === "approved" ? "Approved" : "Changes requested"}
            >
              <PrReviewDecisionIcon decision={reviewDecision} />
            </span>
          )}
          {openPr && (
            <span className={styles.prSignals}>
              {hasPendingComments && (
                <span
                  className={styles.prPendingComments}
                  title={`${pendingCommentCount} unresolved review comment${pendingCommentCount === 1 ? "" : "s"}`}
                >
                  <CommentCountIcon count={pendingCommentCount} />
                </span>
              )}
              {isCiPending && (
                <span
                  className={`${styles.prBadge} ${styles.prCiPending}`}
                  title="CI checks running"
                >
                  CI
                </span>
              )}
              {isBlockedByCi && (
                <span
                  className={`${styles.prBadge} ${styles.prBlockedCi}`}
                  title="CI checks failing"
                >
                  CI
                </span>
              )}
              {isCiPassing && (
                <span
                  className={`${styles.prBadge} ${styles.prCiPassing}`}
                  title="CI checks passing"
                >
                  CI
                </span>
              )}
            </span>
          )}
        </span>
      )}
      {!hasPr && hasInferredPr && (
        <span className={`${styles.prInline} ${styles.pr_inferred}`} title={`Detected from branch name: #${inferredPrNumber!}`}>
          <PrStateIcon state="open" />
          <span className={styles.prNumber}>#{inferredPrNumber!}</span>
        </span>
      )}
      {(hasPr || hasInferredPr) && showBranch && normalizedBranch && (
        <span className={styles.workspaceMetaSeparator} />
      )}
      {showBranch && normalizedBranch && (
        <span className={styles.workspaceBranchInline} title={normalizedBranch}>
          <span className={styles.workspaceBranchIcon}>&#x2387;</span>
          <span className={styles.workspaceBranchText}>{normalizedBranch}</span>
        </span>
      )}
    </span>
  );
}

export function Sidebar() {
  const projects = useAppStore((s) => s.projects);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const addProject = useAppStore((s) => s.addProject);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const addTab = useAppStore((s) => s.addTab);
  const addToast = useAppStore((s) => s.addToast);
  const workspaceDialogProjectId = useAppStore((s) => s.workspaceDialogProjectId);
  const openWorkspaceDialog = useAppStore((s) => s.openWorkspaceDialog);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);
  const updateProject = useAppStore((s) => s.updateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const confirmDialog = useAppStore((s) => s.confirmDialog);
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog);
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const unreadWorkspaceIds = useAppStore((s) => s.unreadWorkspaceIds);
  const activeClaudeWorkspaceIds = useAppStore((s) => s.activeClaudeWorkspaceIds);
  const waitingClaudeWorkspaceIds = useAppStore((s) => s.waitingClaudeWorkspaceIds);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setPrStatuses = useAppStore((s) => s.setPrStatuses);
  const setGhAvailability = useAppStore((s) => s.setGhAvailability);

  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(
    new Set(),
  );
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [workspaceCreation, setWorkspaceCreation] =
    useState<WorkspaceCreationState | null>(null);
  const [showSlowCreateMessage, setShowSlowCreateMessage] = useState(false);
  const [openProjectPrPopoverId, setOpenProjectPrPopoverId] = useState<
    string | null
  >(null);
  const [projectOpenPrs, setProjectOpenPrs] = useState<
    Record<string, OpenPrInfo[]>
  >({});
  const [projectPrLoading, setProjectPrLoading] = useState<
    Record<string, boolean>
  >({});
  const [projectPrError, setProjectPrError] = useState<
    Record<string, string | null>
  >({});
  const [pullingPrKey, setPullingPrKey] = useState<string | null>(null);
  const [projectPrSearch, setProjectPrSearch] = useState("");
  const editRef = useRef<string>("");
  const dialogProject = workspaceDialogProjectId
    ? (projects.find((p) => p.id === workspaceDialogProjectId) ?? null)
    : null;
  const isCreatingWorkspace = workspaceCreation !== null;

  useEffect(() => {
    const unsub = window.api.git.onCreateWorktreeProgress(
      (progress: CreateWorktreeProgressEvent) => {
        if (!progress.requestId) return;
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== progress.requestId) return prev;
          return { ...prev, message: progress.message };
        });
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!workspaceCreation) {
      setShowSlowCreateMessage(false);
      return;
    }

    setShowSlowCreateMessage(false);
    const timer = setTimeout(() => setShowSlowCreateMessage(true), 5000);
    return () => clearTimeout(timer);
  }, [workspaceCreation?.requestId]);

  useEffect(() => {
    if (!openProjectPrPopoverId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenProjectPrPopoverId(null);
        setProjectPrSearch("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openProjectPrPopoverId]);

  useEffect(() => {
    if (!openProjectPrPopoverId) return;
    if (!projects.some((p) => p.id === openProjectPrPopoverId)) {
      setOpenProjectPrPopoverId(null);
      setProjectPrSearch("");
    }
  }, [openProjectPrPopoverId, projects]);

  const closeProjectPrModal = useCallback(() => {
    setOpenProjectPrPopoverId(null);
    setProjectPrSearch("");
  }, []);

  const isProjectExpanded = useCallback(
    (id: string) => {
      return !manualCollapsed.has(id);
    },
    [manualCollapsed],
  );

  const toggleProject = useCallback((id: string) => {
    setManualCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (openProjectPrPopoverId === id) closeProjectPrModal();
  }, [openProjectPrPopoverId, closeProjectPrModal]);

  const handleAddProject = useCallback(async () => {
    const dirPath = await window.api.app.selectDirectory();
    if (!dirPath) return;

    const name = basenameSafe(toPosixPath(dirPath)) || dirPath;
    const id = crypto.randomUUID();
    addProject({ id, name, repoPath: dirPath });
  }, [addProject]);

  const finishCreateWorkspace = useCallback(
    async (
      project: Project,
      name: string,
      type: WorkspaceType,
      branch: string,
      worktreePath: string,
      agentPermissionMode: AgentPermissionMode,
    ) => {
      const wsId = crypto.randomUUID();
      addWorkspace({
        id: wsId,
        name,
        type,
        branch,
        worktreePath,
        projectId: project.id,
        agentPermissionMode,
      });

      const commands = project.startupCommands ?? [];

      if (commands.some((c) => c.command.trim().startsWith("claude"))) {
        await window.api.claude.trustPath(worktreePath).catch(() => {});
      }

      if (commands.length === 0) {
        const ptyId = await window.api.pty.create(worktreePath, undefined, undefined, {
          AGENT_ORCH_WS_ID: wsId,
          AGENT_ORCH_PERMISSION_MODE: agentPermissionMode,
        });
        addTab({
          id: crypto.randomUUID(),
          workspaceId: wsId,
          type: "terminal",
          title: "Terminal",
          ptyId,
        });
      } else {
        let firstTabId: string | null = null;
        for (const cmd of commands) {
          const ptyId = await window.api.pty.create(worktreePath, undefined, undefined, {
            AGENT_ORCH_WS_ID: wsId,
            AGENT_ORCH_PERMISSION_MODE: agentPermissionMode,
          });
          const tabId = crypto.randomUUID();
          if (!firstTabId) firstTabId = tabId;
          addTab({
            id: tabId,
            workspaceId: wsId,
            type: "terminal",
            title: cmd.name || cmd.command,
            ptyId,
          });
          setTimeout(() => {
            window.api.pty.write(ptyId, cmd.command + "\n");
          }, 500);
        }
        if (firstTabId) setActiveTab(firstTabId);
      }
    },
    [addWorkspace, addTab, setActiveTab],
  );

  const handleCreateWorkspace = useCallback(
    async (
      project: Project,
      name: string,
      type: WorkspaceType,
      branch: string,
      newBranch: boolean,
      agentPermissionMode: AgentPermissionMode,
      force = false,
      baseBranch?: string,
    ) => {
      if (workspaceCreation) return;
      const requestId = crypto.randomUUID();
      setWorkspaceCreation({
        requestId,
        message: "Syncing remote...",
      });

      try {
        const worktreePath = await window.api.git.createWorktree(
          project.repoPath,
          name,
          branch,
          newBranch,
          baseBranch,
          force,
          requestId,
        );
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return { ...prev, message: START_TERMINAL_MESSAGE };
        });
        await finishCreateWorkspace(project, name, type, branch, worktreePath, agentPermissionMode);
        openWorkspaceDialog(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create workspace";
        const confirmMessages = [
          {
            key: "WORKTREE_PATH_EXISTS",
            title: "Worktree already exists",
            message: `A leftover directory for workspace "${name}" already exists on disk. Replace it?`,
          },
          {
            key: "BRANCH_CHECKED_OUT",
            title: "Branch in use",
            message: `Branch "${branch}" is checked out in another worktree. Remove the old worktree and continue?`,
          },
        ];
        const confirm = confirmMessages.find((c) => msg.includes(c.key));
        if (confirm) {
          showConfirmDialog({
            ...confirm,
            confirmLabel: "Replace",
            destructive: true,
            onConfirm: () => {
              dismissConfirmDialog();
              handleCreateWorkspace(project, name, type, branch, newBranch, agentPermissionMode, true, baseBranch);
            },
          });
          return;
        }
        addToast({ id: crypto.randomUUID(), message: msg, type: "error" });
      } finally {
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return null;
        });
      }
    },
    [
      workspaceCreation,
      finishCreateWorkspace,
      addToast,
      showConfirmDialog,
      dismissConfirmDialog,
      openWorkspaceDialog,
    ],
  );

  const loadProjectOpenPrs = useCallback(
    async (project: Project) => {
      setProjectPrLoading((prev) => ({ ...prev, [project.id]: true }));
      setProjectPrError((prev) => ({ ...prev, [project.id]: null }));

      try {
        const result = await window.api.github.listOpenPrs(project.repoPath);
        setGhAvailability(project.id, result.available, result.error);
        if (!result.available) {
          setProjectOpenPrs((prev) => ({ ...prev, [project.id]: [] }));
          setProjectPrError((prev) => ({
            ...prev,
            [project.id]: githubErrorMessage(result.error),
          }));
          return;
        }

        setProjectOpenPrs((prev) => ({ ...prev, [project.id]: result.data }));
        const branchStatuses: Record<string, OpenPrInfo | null> = {};
        for (const pr of result.data) {
          if (!pr.headRefName) continue;
          branchStatuses[pr.headRefName] = pr;
        }
        if (Object.keys(branchStatuses).length > 0) {
          setPrStatuses(project.id, branchStatuses);
        }
      } catch {
        setProjectPrError((prev) => ({
          ...prev,
          [project.id]: "Failed to load open pull requests.",
        }));
      } finally {
        setProjectPrLoading((prev) => ({ ...prev, [project.id]: false }));
      }
    },
    [setGhAvailability, setPrStatuses],
  );

  const handleToggleProjectPrPopover = useCallback(
    (project: Project) => {
      setOpenProjectPrPopoverId((prev) => {
        const next = prev === project.id ? null : project.id;
        if (next === project.id) {
          setProjectPrSearch("");
          void loadProjectOpenPrs(project);
        } else {
          setProjectPrSearch("");
        }
        return next;
      });
    },
    [loadProjectOpenPrs],
  );

  const handlePullPrLocally = useCallback(
    async (project: Project, pr: OpenPrInfo, force = false) => {
      const localBranch = buildPrLocalBranch(pr);
      const existing = workspaces.find(
        (ws) => ws.projectId === project.id && ws.branch === localBranch,
      );
      if (existing) {
        setActiveWorkspace(existing.id);
        closeProjectPrModal();
        return;
      }
      if (workspaceCreation) return;

      const workspaceName = uniqueWorkspaceName(
        buildPrWorkspaceName(pr),
        project.id,
        workspaces,
      );
      const requestId = crypto.randomUUID();
      const prKey = `${project.id}:${pr.number}`;
      setPullingPrKey(prKey);
      setWorkspaceCreation({
        requestId,
        message: `Fetching PR #${pr.number}...`,
      });

      try {
        const { worktreePath, branch } =
          await window.api.git.createWorktreeFromPr(
            project.repoPath,
            workspaceName,
            pr.number,
            localBranch,
            force,
            requestId,
          );
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return { ...prev, message: START_TERMINAL_MESSAGE };
        });
        await finishCreateWorkspace(
          project,
          workspaceName,
          DEFAULT_WORKSPACE_TYPE,
          branch,
          worktreePath,
          DEFAULT_AGENT_PERMISSION_MODE,
        );
        closeProjectPrModal();
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `Failed to pull PR #${pr.number} locally`;
        if (msg.includes("WORKTREE_PATH_EXISTS") && !force) {
          showConfirmDialog({
            title: "Workspace path exists",
            message: `A workspace directory for "${workspaceName}" already exists. Replace it?`,
            confirmLabel: "Replace",
            destructive: true,
            onConfirm: () => {
              dismissConfirmDialog();
              void handlePullPrLocally(project, pr, true);
            },
          });
          return;
        }
        addToast({ id: crypto.randomUUID(), message: msg, type: "error" });
      } finally {
        setPullingPrKey((prev) => (prev === prKey ? null : prev));
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return null;
        });
      }
    },
    [
      workspaceCreation,
      workspaces,
      setActiveWorkspace,
      closeProjectPrModal,
      finishCreateWorkspace,
      showConfirmDialog,
      dismissConfirmDialog,
      addToast,
    ],
  );

  const handleSelectWorkspace = useCallback(
    (wsId: string) => {
      setActiveWorkspace(wsId);
    },
    [setActiveWorkspace],
  );

  const handleDeleteWorkspace = useCallback(
    (e: React.MouseEvent, ws: { id: string; name: string }) => {
      e.stopPropagation();
      if (e.shiftKey) {
        deleteWorkspace(ws.id);
        return;
      }
      showConfirmDialog({
        title: "Delete Workspace",
        message: `Delete workspace "${ws.name}"? This will remove the git worktree from disk.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => {
          deleteWorkspace(ws.id);
          dismissConfirmDialog();
        },
      });
    },
    [showConfirmDialog, deleteWorkspace, dismissConfirmDialog],
  );

  const handleDeleteProject = useCallback(
    (e: React.MouseEvent, project: Project) => {
      e.stopPropagation();
      const wsCount = workspaces.filter(
        (w) => w.projectId === project.id,
      ).length;
      showConfirmDialog({
        title: "Delete Project",
        message: `Delete project "${project.name}"${wsCount > 0 ? ` and its ${wsCount} workspace${wsCount > 1 ? "s" : ""}` : ""}? This will remove all git worktrees from disk.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => {
          deleteProject(project.id);
          dismissConfirmDialog();
        },
      });
    },
    [workspaces, showConfirmDialog, deleteProject, dismissConfirmDialog],
  );

  const openPrUrl = useCallback(
    (projectId: string, url: string) => {
      const provider =
        projects.find((project) => project.id === projectId)?.prLinkProvider ??
        "github";
      window.open(providerUrl(url, provider));
    },
    [projects],
  );

  const projectPrModalProject = openProjectPrPopoverId
    ? (projects.find((p) => p.id === openProjectPrPopoverId) ?? null)
    : null;
  const modalOpenPrs = projectPrModalProject
    ? (projectOpenPrs[projectPrModalProject.id] ?? [])
    : [];
  const modalPrLoading = projectPrModalProject
    ? !!projectPrLoading[projectPrModalProject.id]
    : false;
  const modalPrError = projectPrModalProject
    ? projectPrError[projectPrModalProject.id] ?? null
    : null;
  const searchNeedle = projectPrSearch.trim().toLowerCase();
  const filteredModalPrs =
    searchNeedle.length === 0
      ? modalOpenPrs
      : modalOpenPrs.filter((pr) => {
          const haystack = [
            pr.title,
            pr.authorLogin ?? "",
            pr.headRefName,
            `#${pr.number}`,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchNeedle);
        });

  return (
    <div className={styles.sidebar}>
      <div className={styles.titleArea} />

      <div className={styles.projectList}>
        {projects.length === 0 && (
          <div className={styles.emptyState}>
            <span
              style={{
                color: "var(--colorNeutralForeground3)",
                fontSize: "var(--fontSizeBase200)",
                padding: "0 24px",
                fontFamily: "var(--fontFamilyBase)",
              }}
            >
              No projects yet. Add a git repository to get started.
            </span>
          </div>
        )}

        {projects.map((project, projectIndex) => {
          const isExpanded = isProjectExpanded(project.id);
          const projectWorkspaces = workspaces.filter(
            (w) => w.projectId === project.id,
          );

          return (
            <div key={project.id} className={styles.projectSection}>
              {projectIndex > 0 && (
                <Divider className={styles.sectionDivider} />
              )}
              <div
                className={styles.projectHeader}
                onClick={() => toggleProject(project.id)}
              >
                <span
                  className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ""}`}
                >
                  &#x25B6;
                </span>
                <span className={styles.projectName}>{project.name}</span>
                <span className={styles.headerActions}>
                  <Tooltip label="Project settings">
                    <button
                      aria-label={`Project settings for ${project.name}`}
                      className={styles.headerActionBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(project);
                      }}
                    >
                      &#x2699;
                    </button>
                  </Tooltip>
                  <Tooltip label="Open pull requests">
                    <button
                      className={`${styles.headerActionBtn} ${styles.headerActionBtnPr}`}
                      aria-expanded={openProjectPrPopoverId === project.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleProjectPrPopover(project);
                      }}
                    >
                      PR
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete project">
                    <button
                      aria-label={`Delete project ${project.name}`}
                      className={`${styles.headerActionBtn} ${styles.headerActionBtnDanger}`}
                      onClick={(e) => handleDeleteProject(e, project)}
                    >
                      &#x2715;
                    </button>
                  </Tooltip>
                </span>
              </div>

              {isExpanded && (
                <div className={styles.workspaceList}>
                  {projectWorkspaces.map((ws) => {
                    const isEditing = editingWorkspaceId === ws.id;
                    const isAutoName = /^ws-[a-z0-9]+$/.test(ws.name);
                    const metaBranch = ws.branch || basenameSafe(ws.worktreePath);
                    const displayName = isAutoName ? metaBranch : ws.name;
                    const showMeta = !!(metaBranch && metaBranch !== displayName);
                    const isRunning = activeClaudeWorkspaceIds.has(ws.id);
                    const isWaiting = !isRunning && waitingClaudeWorkspaceIds.has(ws.id);
                    const isUnread = !isRunning && !isWaiting && unreadWorkspaceIds.has(ws.id);

                    return (
                      <div
                        key={ws.id}
                        className={`${styles.workspaceItem} ${
                          ws.id === activeWorkspaceId ? styles.active : ""
                        } ${isUnread ? styles.unread : ""} ${isRunning ? styles.claudeActive : ""} ${isWaiting ? styles.waitingInput : ""}`}
                        onClick={() =>
                          !isEditing && handleSelectWorkspace(ws.id)
                        }
                        onDoubleClick={() => {
                          editRef.current = displayName;
                          setEditingWorkspaceId(ws.id);
                        }}
                      >
                        <span className={styles.workspaceIcon}>
                          {"\u2387"}
                        </span>
                        <div className={styles.workspaceNameCol}>
                          {isEditing ? (
                            <input
                              className={styles.workspaceNameInput}
                              defaultValue={displayName}
                              autoFocus
                              ref={(el) => {
                                if (el) {
                                  el.select();
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                } else if (e.key === "Escape") {
                                  editRef.current = "";
                                  setEditingWorkspaceId(null);
                                }
                              }}
                              onBlur={(e) => {
                                const val = e.currentTarget.value.trim();
                                if (val && val !== ws.name) {
                                  renameWorkspace(ws.id, val);
                                }
                                setEditingWorkspaceId(null);
                              }}
                            />
                          ) : (
                            <span className={styles.workspaceName}>
                              {displayName}
                            </span>
                          )}
                          <WorkspaceMeta
                            projectId={ws.projectId}
                            branch={metaBranch}
                            showBranch={!!showMeta}
                          />
                        </div>
                        <Tooltip label="Delete workspace">
                          <button
                            aria-label={`Delete workspace ${displayName}`}
                            className={styles.workspaceDeleteBtn}
                            onClick={(e) => handleDeleteWorkspace(e, ws)}
                          >
                            &#x2715;
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}

                  <GhStatusHint projectId={project.id} />

                  <Tooltip
                    label="New workspace"
                    shortcut={formatShortcut(SHORTCUT_MAP.newWorkspace.mac, SHORTCUT_MAP.newWorkspace.win)}
                  >
                    <Button
                      appearance="subtle"
                      className={styles.actionButton}
                      onClick={() => openWorkspaceDialog(project.id)}
                      icon={<span className={styles.actionIcon}>+</span>}
                    >
                      New workspace
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.actions}>
        <Tooltip label="Add project">
          <Button
            appearance="subtle"
            className={styles.actionButton}
            onClick={handleAddProject}
            icon={<span className={styles.actionIcon}>+</span>}
          >
            Add project
          </Button>
        </Tooltip>
        <Tooltip
          label="Settings"
          shortcut={formatShortcut(SHORTCUT_MAP.settings.mac, SHORTCUT_MAP.settings.win)}
        >
          <Button
            appearance="subtle"
            className={styles.actionButton}
            onClick={toggleSettings}
            icon={<span className={styles.actionIcon}>{"\u2699"}</span>}
          >
            Settings
          </Button>
        </Tooltip>
      </div>

      {projectPrModalProject && (
        <div
          className={styles.projectPrModalOverlay}
          onClick={closeProjectPrModal}
        >
          <div
            className={styles.projectPrModal}
            data-project-pr-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.projectPrModalHeader}>
              <div className={styles.projectPrModalHeaderText}>
                <span className={styles.projectPrModalTitle}>Open Pull Requests</span>
                <span className={styles.projectPrModalSubtitle}>
                  {projectPrModalProject.name}
                </span>
              </div>
              <div className={styles.projectPrModalHeaderActions}>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => {
                    void loadProjectOpenPrs(projectPrModalProject);
                  }}
                  disabled={modalPrLoading}
                >
                  Refresh
                </Button>
                <button
                  className={styles.projectPrModalCloseBtn}
                  onClick={closeProjectPrModal}
                  aria-label="Close pull requests modal"
                >
                  &#x2715;
                </button>
              </div>
            </div>

            <div className={styles.projectPrModalToolbar}>
              <input
                className={styles.projectPrSearchInput}
                placeholder="Filter by title, author, branch, #"
                value={projectPrSearch}
                onChange={(e) => setProjectPrSearch(e.target.value)}
              />
              <span className={styles.projectPrModalSummary}>
                {filteredModalPrs.length}
                {filteredModalPrs.length !== modalOpenPrs.length
                  ? ` of ${modalOpenPrs.length}`
                  : ""}{" "}
                open
              </span>
            </div>

            {modalPrLoading && (
              <div
                className={styles.projectPrLoadingRow}
                role="status"
                aria-live="polite"
              >
                <span
                  className={styles.projectPrLoadingSpinner}
                  aria-hidden="true"
                />
                <span>Loading open pull requests...</span>
              </div>
            )}

            {!modalPrLoading && modalPrError && (
              <div className={`${styles.projectPrStatus} ${styles.projectPrStatusError}`}>
                {modalPrError}
              </div>
            )}
            {!modalPrLoading && !modalPrError && modalOpenPrs.length === 0 && (
              <div className={styles.projectPrStatus}>No open pull requests.</div>
            )}
            {!modalPrLoading &&
              !modalPrError &&
              modalOpenPrs.length > 0 &&
              filteredModalPrs.length === 0 && (
                <div className={styles.projectPrStatus}>
                  No pull requests match "{projectPrSearch}".
                </div>
              )}
            {!modalPrError && filteredModalPrs.length > 0 && (
              <div className={styles.projectPrModalList}>
                {filteredModalPrs.map((pr) => {
                  const prKey = `${projectPrModalProject.id}:${pr.number}`;
                  const openPr = pr.state === "open";
                  const pendingCommentCount = openPr
                    ? Math.max(0, pr.pendingCommentCount || 0)
                    : 0;
                  const hasPendingComments = pendingCommentCount > 0;
                  const isBlockedByCi = openPr && !!pr.isBlockedByCi;
                  const isApproved = openPr && !!pr.isApproved;
                  const isCiPassing =
                    openPr && pr.checkStatus === "passing" && !isBlockedByCi;
                  const ciChipLabel = openPr
                    ? isBlockedByCi
                      ? "CI blocked"
                      : pr.checkStatus === "failing"
                        ? "CI failing"
                        : pr.checkStatus === "pending"
                          ? "CI pending"
                          : isCiPassing
                            ? "CI passing"
                            : null
                    : null;
                  const commentChipLabel = hasPendingComments
                    ? `${pendingCommentCount} comment${pendingCommentCount === 1 ? "" : "s"}`
                    : null;
                  const localBranch = buildPrLocalBranch(pr);
                  const existingWorkspace = workspaces.find(
                    (ws) =>
                      ws.projectId === projectPrModalProject.id &&
                      ws.branch === localBranch,
                  );
                  const isPulling = pullingPrKey === prKey;
                  const disablePull = !!workspaceCreation || !!pullingPrKey;

                  return (
                    <div key={pr.number} className={styles.projectPrRow}>
                      <div className={styles.projectPrRowMain}>
                        <button
                          className={styles.projectPrLink}
                          onClick={() => openPrUrl(projectPrModalProject.id, pr.url)}
                          title={`PR #${pr.number}: ${pr.title}`}
                        >
                          <span className={`${styles.prInline} ${styles.pr_open}`}>
                            <PrStateIcon state={pr.state} />
                            <span className={styles.prNumber}>#{pr.number}</span>
                          </span>
                          <span className={styles.projectPrItemTitle}>{pr.title}</span>
                        </button>
                        <div className={styles.projectPrMetaRow}>
                          {pr.authorLogin && (
                            <span className={styles.projectPrAuthor}>@{pr.authorLogin}</span>
                          )}
                          <span className={styles.projectPrBranch}>{localBranch}</span>
                        </div>
                      </div>
                      <div className={styles.projectPrRowSide}>
                        <div className={styles.projectPrStatusGroup}>
                          {ciChipLabel && (
                            <span
                              className={`${styles.projectPrStatusChip} ${
                                isBlockedByCi || pr.checkStatus === "failing"
                                  ? styles.projectPrStatusChipDanger
                                  : pr.checkStatus === "pending"
                                    ? styles.projectPrStatusChipNeutral
                                    : styles.projectPrStatusChipSuccess
                              }`}
                              title={ciChipLabel}
                            >
                              {ciChipLabel}
                            </span>
                          )}
                          {isApproved && (
                            <span
                              className={`${styles.projectPrStatusChip} ${styles.projectPrStatusChipSuccess}`}
                              title="Approved"
                            >
                              Approved
                            </span>
                          )}
                          {commentChipLabel && (
                            <span
                              className={`${styles.projectPrStatusChip} ${styles.projectPrStatusChipWarning}`}
                              title={`${pendingCommentCount} unresolved review comment${pendingCommentCount === 1 ? "" : "s"}`}
                            >
                              {commentChipLabel}
                            </span>
                          )}
                        </div>
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() => {
                            void handlePullPrLocally(projectPrModalProject, pr);
                          }}
                          disabled={disablePull}
                        >
                          {existingWorkspace
                            ? "Focus workspace"
                            : isPulling
                              ? "Pulling..."
                              : "Pull locally"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {dialogProject && (
        <WorkspaceDialog
          project={dialogProject}
          onConfirm={(name, type, branch, newBranch, baseBranch, agentPermissionMode) => {
            handleCreateWorkspace(
              dialogProject,
              name,
              type,
              branch,
              newBranch,
              agentPermissionMode,
              false,
              baseBranch,
            );
          }}
          onCancel={() => {
            if (!isCreatingWorkspace) openWorkspaceDialog(null);
          }}
          isCreating={isCreatingWorkspace}
          createProgressMessage={workspaceCreation?.message}
          showSlowCreateMessage={showSlowCreateMessage}
        />
      )}

      {editingProject && (
        <ProjectSettingsDialog
          project={editingProject}
          onSave={({ startupCommands, prLinkProvider }) => {
            updateProject(editingProject.id, {
              startupCommands,
              prLinkProvider,
            });
            setEditingProject(null);
          }}
          onCancel={() => setEditingProject(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          destructive={confirmDialog.destructive}
          onConfirm={confirmDialog.onConfirm}
          onCancel={dismissConfirmDialog}
        />
      )}
    </div>
  );
}
