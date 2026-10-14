# build-template

The starting point for every build repo: a README, an MIT license, a pull request template and the `pipeline` workflow that moves the work forward. Repos are created from it by a seeding script, which then adds the labels, milestones, issues, blocked-by links, a ruleset on `main` and the first branches. A repo made from it replaces this README with its own.

## How a build repo moves

Each stage of the plan is an issue, and it waits on the issues it's blocked by.

1. When an issue's blockers are all closed, the workflow opens a branch for it, named `<issue number>-<title>` and linked to the issue.
2. You work on that branch and open a pull request (`Closes #<n>` is already in the template).
3. Merging closes the issue. In the same run, the workflow opens branches for whatever that unblocked.

Issues labeled `who: owner` are hand work, so they get no branch; close them yourself when they're done. To re-run the workflow, use **Actions → pipeline → Run workflow**.
