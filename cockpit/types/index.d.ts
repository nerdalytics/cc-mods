export type StatusLimit = { kind: string; percentUsed: number; resetsAt?: string };

export type StatusUsage = {
  context: { tokens?: number; window: number };
  rateLimits: StatusLimit[];
};

// Tokens are all four usage counts summed; `requests` counts model requests, `unpriced` those no price matched.
export type StatusSpend = { tokens: number; usd: number; requests: number; unpriced: number };

// The main conversation's prompt cache as its last request left it: when (ms), how long it lives (s), and what the
// next prompt's cached prefix costs read while warm and written again once cold (USD; undefined when unpriced).
// `prompt` is that last request's prompt in tokens, `base` the session's first: what a fresh session starts near.
export type StatusCache = { at: number; ttl: number; read?: number; write?: number; prompt: number; base: number };

export type StatusTokens = { main: StatusSpend; agents: StatusSpend & { count: number }; cache?: StatusCache };

// `defaultBranch` is "" when origin names none; ahead/behind count against the default branch when `vsDefault`.
// added/deleted are lines, changed is files, as `git diff --numstat HEAD` counts them.
// `root`, `cwd` and `top` are folders on disk: the project's, the shell's and the checkout's (the worktree's when linked).
export type StatusGit = {
  root: string;
  cwd: string;
  top: string;
  // The tracked remote's web address and the branch it tracks there; both "" when no remote has the branch.
  web: string;
  base: string;
  branch: string;
  defaultBranch: string;
  basedOff: string;
  worktree: string;
  ahead: number;
  behind: number;
  vsDefault: boolean;
  added: number;
  deleted: number;
  changed: number;
  conflict: boolean;
};

// The branch's pull request as `gh pr view` reports it; `review` is GitHub's reviewDecision ("" for none).
export type StatusPr = {
  number: number;
  url: string;
  // Each failed check's page, in GitHub's order; "" for one that gave no page.
  failedUrls: string[];
  // GitHub's state, with an open pull request split by isDraft. Only an open or draft one shows its glyphs.
  state: "open" | "draft" | "merged" | "closed";
  conflicting: boolean;
  review: string;
  comments: number;
  checks: { pending: number; failure: number; success: number };
};

// The usage endpoint's extra_usage as the latest lookup read it, at `at` (ms). `spent` and `cap` are in minor units, `decimals`
// places from the whole; `reason` is disabled_reason, null when none.
export type StatusCredits = { at: number; enabled: boolean; spent: number; cap: number; decimals: number; currency: string; capReached: boolean; reason: string | null };

declare module "claude-code" {
  interface PluginState {
    cockpit: {
      usage: StatusUsage;
      // k, the 7d percent that 1% of the 5h costs, once measured, and the first reading of the current 5h window it is
      // measured from: each reset time (ms) and each percent used.
      paceK: { k?: number; base?: { reset5h: number; reset7d: number; p5: number; p7: number } };
      model: string;
      tokens: StatusTokens;
      git: StatusGit;
      pr: StatusPr | null;
      turns: number;
      compactAt: number;
      sent: number;
      // When each offer under the prompt was dismissed (ms).
      dismissed: { fresh?: number; compact?: number };
      // Limits a session of this account was refused on: the window's kind, and when it resets (ms).
      rejected: Record<string, number>;
      // The handoff file written since this session started: its absolute path, size and when it was written (ms).
      handoff: { path: string; bytes: number; at: number } | null;
      tick: number;
      // TEMPORARY: the PR fetch trace, read by the debug mod's /debug:pr-trace pane.
      prTrace: string[];
      // Why the handoff did or did not run while its window was open, newest last; read by the debug mod's /debug:handoff-trace pane.
      handoffTrace: string[];
      // When the latest copy of the module loaded: an older copy's tick stops once it reads a newer one.
      load: number;
      // When the person last prompted, and when the mod last ran a handoff and a compaction (ms): they outlive a reload of the module.
      stretch: { promptAt: number; handoffAt: number; compactedAt: number };
      // The latest usage lookup's extra_usage, and the billing day: the day of the month, in UTC, of the account's subscription start.
      credits: StatusCredits;
      billing: number;
      // The usage lookup's pacing, kept so a reload of the module keeps it: the time (ms) before which no lookup runs, and the failures in a row so far.
      lookupPace: { notBefore: number; failures: number };
    };
  }
}
