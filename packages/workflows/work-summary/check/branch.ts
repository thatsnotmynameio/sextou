import type { Checked, Summary } from './summary.ts';

// What git says of the branch, from the merge base of the base ref and HEAD.
export interface Branch {
  // The paths the diff from the merge base to HEAD changed, with no rename
  // detection: a renamed file under its old path and its new one.
  changed: string[];
  // The commits from the merge base to HEAD.
  commits: Commit[];
  // The paths in HEAD's tree.
  tree: string[];
}

export interface Commit {
  // Its short SHA, as git abbreviates it.
  sha: string;
  subject: string;
  // The units its Units: trailers name.
  units: string[];
  // The paths it changed against its first parent.
  paths: string[];
}

// The plan's units: the U-ID of each `### U<n>. ` heading, outside fenced
// code, as ce-plan writes them. A U-ID cited in prose or a table is no unit.
export function planUnits(plan: string): string[] {
  const units: string[] = [];
  let fence: string | undefined;
  for (const line of plan.split('\n')) {
    const marker = /^(```|~~~)/.exec(line)?.[1];
    if (fence === undefined && marker !== undefined) {
      fence = marker;
    } else if (fence !== undefined) {
      if (marker === fence) {
        fence = undefined;
      }
    } else {
      const unit = /^### (U\d+)\. /.exec(line)?.[1];
      if (unit !== undefined) {
        units.push(unit);
      }
    }
  }
  return units;
}

// Every reason the summary, as the form check left it, contradicts the
// branch, the plan's `units` or HEAD's tree, R15 to R18. The paths `ignore`
// names, exact paths in the repository, count on neither side.
export function checkBranch(
  summary: Checked<Summary>,
  branch: Branch,
  units: string[],
  ignore: string[],
): string[] {
  const reasons: string[] = [];
  const counted = (path: string) => !ignore.includes(path);
  const {
    changed_files: listed,
    u_ids_attempted: attempted,
    u_ids_completed: completed,
  } = summary;

  // R15: changed_files is the diff, ignored paths left out.
  if (listed !== undefined) {
    for (const path of branch.changed.filter(counted)) {
      if (!listed.includes(path)) {
        reasons.push(`changed_files lacks ${path}, which the branch changed`);
      }
    }
    for (const path of listed.filter(counted)) {
      if (!branch.changed.includes(path)) {
        reasons.push(
          `changed_files has ${path}, which the branch did not change`,
        );
      }
    }
  }

  // R16: every unit tried or completed is the plan's.
  for (const [field, list] of [
    ['u_ids_attempted', attempted],
    ['u_ids_completed', completed],
  ] as const) {
    for (const unit of list ?? []) {
      if (!units.includes(unit)) {
        reasons.push(`${field} has ${unit}, which the plan lacks`);
      }
    }
  }

  // R17: a commit names each completed unit, and every commit that changes
  // more than ignored paths names a unit of the plan.
  for (const unit of completed ?? []) {
    if (!branch.commits.some((commit) => commit.units.includes(unit))) {
      reasons.push(
        `${unit} is completed, but no commit names it in a Units: trailer`,
      );
    }
  }
  for (const commit of branch.commits) {
    const name = `commit ${commit.sha} (${commit.subject})`;
    const unknown = commit.units.filter((unit) => !units.includes(unit));
    for (const unit of unknown) {
      reasons.push(`${name} names ${unit}, which the plan lacks`);
    }
    if (commit.units.length === 0 && commit.paths.some(counted)) {
      reasons.push(`${name} names no unit of the plan in a Units: trailer`);
    }
  }

  // R18: the tests read or used exist at HEAD, and those added or changed
  // are in the diff.
  summary.verification_evidence?.forEach((entry, index) => {
    const tests = entry?.tests;
    const at = `verification_evidence[${index}].tests`;
    for (const field of ['inspected', 'used_unchanged'] as const) {
      for (const path of tests?.[field] ?? []) {
        if (!branch.tree.includes(path)) {
          reasons.push(`${at}.${field} has ${path}, which HEAD lacks`);
        }
      }
    }
    for (const path of tests?.added_or_changed ?? []) {
      if (!branch.changed.includes(path)) {
        reasons.push(
          `${at}.added_or_changed has ${path}, which the branch did not change`,
        );
      }
    }
  });

  return reasons;
}
