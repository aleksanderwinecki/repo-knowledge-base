/**
 * Progress reporting and error collection for indexing pipelines.
 *
 * ProgressReporter: TTY-aware in-place progress counter.
 * ErrorCollector: Categorized git/indexing error aggregation with grouped summary output.
 */

export type ErrorCategory =
  | 'worktree_conflict'
  | 'dirty_tree'
  | 'timeout'
  | 'no_branch'
  | 'other';

export interface CollectedError {
  repo: string;
  category: ErrorCategory;
  message: string;
}

export interface PipelineCallbacks {
  progress?: ProgressReporter;
  errors?: ErrorCollector;
}

// ---------------------------------------------------------------------------
// ProgressReporter
// ---------------------------------------------------------------------------

export class ProgressReporter {
  private readonly stream: NodeJS.WriteStream;
  private readonly isTTY: boolean;

  constructor(stream?: NodeJS.WriteStream) {
    this.stream = stream ?? process.stderr;
    this.isTTY = !!this.stream.isTTY;
  }

  /**
   * Write a progress line.
   * - No label: "Refreshing [current/total]..."
   * - With label: "Indexing [current/total] label..."
   */
  update(current: number, total: number, label?: string): void {
    const text = label
      ? `Indexing [${current}/${total}] ${label}...`
      : `Refreshing [${current}/${total}]...`;

    if (this.isTTY) {
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
      this.stream.write(text);
    } else {
      this.stream.write(text + '\n');
    }
  }

  /**
   * Finish progress output.
   * On TTY: clears the line, optionally writes a final message.
   * On non-TTY: writes the message (if any) as a plain line.
   */
  finish(message?: string): void {
    if (this.isTTY) {
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
      if (message) {
        this.stream.write(message + '\n');
      }
    } else {
      if (message) {
        this.stream.write(message + '\n');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Exclude<ErrorCategory, 'no_branch'>, string> = {
  worktree_conflict: 'Worktree conflicts',
  dirty_tree: 'Dirty working trees',
  timeout: 'Timeouts',
  other: 'Other errors',
};

function classifyGitError(msg: string): ErrorCategory {
  if (msg.includes('dirty working tree')) return 'dirty_tree';
  if (msg.includes('ETIMEDOUT') || msg.includes('SIGTERM')) return 'timeout';
  if (msg.includes('already checked out') || msg.includes('is locked'))
    return 'worktree_conflict';
  return 'other';
}

// ---------------------------------------------------------------------------
// ErrorCollector
// ---------------------------------------------------------------------------

export class ErrorCollector {
  private readonly refreshErrors: CollectedError[] = [];
  private readonly indexErrors: CollectedError[] = [];
  private readonly noBranchRepos: string[] = [];

  addRefreshError(repo: string, errorMsg: string): void {
    this.refreshErrors.push({
      repo,
      category: classifyGitError(errorMsg),
      message: errorMsg,
    });
  }

  addNoBranch(repo: string): void {
    this.noBranchRepos.push(repo);
  }

  addIndexError(repo: string, errorMsg: string): void {
    this.indexErrors.push({
      repo,
      category: 'other',
      message: errorMsg,
    });
  }

  hasErrors(): boolean {
    return (
      this.refreshErrors.length > 0 ||
      this.indexErrors.length > 0 ||
      this.noBranchRepos.length > 0
    );
  }

  /**
   * Print a grouped error summary to the provided stream.
   * Writes nothing if there are no errors.
   */
  printSummary(stream: NodeJS.WriteStream): void {
    if (!this.hasErrors()) return;

    // No-branch repos
    if (this.noBranchRepos.length > 0) {
      stream.write(
        `${this.noBranchRepos.length} repos had no main/master branch: ${this.noBranchRepos.join(', ')}\n`,
      );
    }

    // Refresh errors grouped by category
    const grouped = new Map<ErrorCategory, CollectedError[]>();
    for (const err of this.refreshErrors) {
      const list = grouped.get(err.category);
      if (list) {
        list.push(err);
      } else {
        grouped.set(err.category, [err]);
      }
    }

    for (const [category, errors] of grouped) {
      if (category === 'no_branch') continue;
      const label =
        CATEGORY_LABELS[category as Exclude<ErrorCategory, 'no_branch'>] ??
        category;
      stream.write(`${label} (${errors.length}):\n`);
      for (const err of errors) {
        stream.write(`  - ${err.repo}: ${err.message}\n`);
      }
    }

    // Indexing errors
    if (this.indexErrors.length > 0) {
      stream.write(`Indexing errors (${this.indexErrors.length}):\n`);
      for (const err of this.indexErrors) {
        stream.write(`  - ${err.repo}: ${err.message}\n`);
      }
    }
  }
}
