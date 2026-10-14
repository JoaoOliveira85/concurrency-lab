// Run by .github/workflows/pipeline.yml. Needs only Node and GITHUB_TOKEN.
// 1. A merged pull request from a `<n>-…` branch closes issue n.
// 2. Every open issue labeled `who: you` or `who: assist`, whose blockers are all closed and
//    that has no linked branch yet, gets one: `<n>-<title>`, from the default branch.
// Run it locally with GITHUB_TOKEN, GITHUB_REPOSITORY=owner/name and no event to do step 2 only.
import { readFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are needed");
const [owner, name] = repo.split("/");
const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

async function rest(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).replace(/-$/, "");

// 1. Close the issue of a merged pull request.
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
if (process.env.GITHUB_EVENT_NAME === "pull_request" && event.pull_request?.merged) {
  const number = event.pull_request.head.ref.match(/^(\d+)-/)?.[1];
  if (number) {
    const issue = await rest("GET", `/repos/${repo}/issues/${number}`);
    if (issue.state === "open" && !issue.pull_request) {
      await rest("PATCH", `/repos/${repo}/issues/${number}`, { state: "closed", state_reason: "completed" });
      console.log(`closed #${number} (merged in #${event.pull_request.number})`);
    }
  }
}

// 2. Open branches for unblocked issues.
const issues = [];
let after = null;
let head = null;
do {
  const data = await graphql(
    `query($owner: String!, $name: String!, $after: String) {
      repository(owner: $owner, name: $name) {
        id
        defaultBranchRef { target { oid } }
        issues(states: OPEN, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id number title
            labels(first: 20) { nodes { name } }
            blockedBy(first: 50) { nodes { state } }
            linkedBranches(first: 1) { totalCount }
          }
        }
      }
    }`,
    { owner, name, after },
  );
  head = data.repository.defaultBranchRef.target.oid;
  issues.push(...data.repository.issues.nodes);
  after = data.repository.issues.pageInfo.hasNextPage ? data.repository.issues.pageInfo.endCursor : null;
} while (after);

let opened = 0;
for (const issue of issues.sort((a, b) => a.number - b.number)) {
  const labels = issue.labels.nodes.map((l) => l.name);
  if (!labels.includes("who: you") && !labels.includes("who: assist")) continue;
  if (issue.blockedBy.nodes.some((b) => b.state === "OPEN")) continue;
  if (issue.linkedBranches.totalCount > 0) continue;
  const branch = `${issue.number}-${slug(issue.title)}`;
  await graphql(
    `mutation($issue: ID!, $oid: GitObjectID!, $name: String!) {
      createLinkedBranch(input: { issueId: $issue, oid: $oid, name: $name }) { linkedBranch { id } }
    }`,
    { issue: issue.id, oid: head, name: branch },
  );
  console.log(`opened ${branch} for #${issue.number}`);
  opened++;
}
console.log(opened ? `${opened} branch(es) opened` : "nothing newly unblocked");
