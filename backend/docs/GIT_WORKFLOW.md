# Apply the foundation manually

The assistant has not connected to GitHub, created a commit, pushed a branch, or
modified the actual repository. This starter contains only backend files, with
no .git directory. Review it, then commit it yourself with your configured identity.
Follow your course's AI-use and attribution rules when describing the work.

## 1. Prepare the existing checkout

Open your existing QueueSmart repository terminal. Inspect changes first:

```sh
git status
git remote -v
```

If files are modified, save them in a meaningful commit on their current branch
before switching. Do not discard changes or force-reset. Confirm origin is the
intended QueueSmart repository. Then:

```sh
git switch main
git pull --ff-only origin main
```

If this fails because main has diverged, resolve that history before proceeding.
Copy only this package's `backend/` folder alongside the existing `frontend/`.
If backend already exists by then, compare the files and merge selectively rather
than replacing it. Do not copy the chat workspace, output folders, or AGENTS.md.

## 2. Verify and review

```sh
cd backend
npm ci
npm run check
npm start
```

Check `http://localhost:3001/api/health`, stop the server with Ctrl+C, and return:

```sh
cd ..
git status --short
git diff -- frontend
git config user.name
git config user.email
```

Your frontend diff should be empty. Git author identity determines commit
attribution; read-only browsing does not create a contributor. Set your own correct
identity if missing. Review added files in your editor: untracked files do not
appear in ordinary git diff output. Keep .env and node_modules out of commits.

## 3. Commit the foundation in reviewable stages

Use actual completed groups, not empty commits or fabricated individual authors:

```sh
git add backend/package.json backend/package-lock.json backend/.gitignore backend/.env.example backend/.nvmrc backend/jest.config.js backend/src/app.js backend/src/server.js backend/src/shared backend/src/middleware backend/src/modules
git diff --cached --stat
git commit -m "chore: initialize A3 backend and shared contracts"
git add backend/tests backend/README.md backend/docs
git diff --cached --stat
git commit -m "test: verify shared backend and document team contracts"
```

These are suggested checkpoints for this setup only. Each teammate still authors
and tests their own feature work. If the team prefers one cohesive foundation
commit, stage the whole reviewed backend folder and make one commit instead.

## 4. Push main before anyone branches

```sh
git status
git push origin main
git fetch origin
git log -1 --oneline origin/main
```

Verify the latest foundation commit is visible on GitHub main. If branch protection
rejects a direct push, keep the local commits and use the team's pull-request flow:

```sh
git switch -c chore/a3-backend-setup
git push -u origin chore/a3-backend-setup
```

Open a PR to main, obtain review, merge it, then switch to main and pull. Do not
force-push or disable branch protection. If a squash merge causes local main to
diverge, preserve the local branch and reconcile with the team before continuing.

## 5. Each person creates their own branch from published main

Everyone runs:

```sh
git switch main
git pull --ff-only origin main
```

Then each member runs only their own command (new A3 names preserve A2 branches):

| Member | Command |
| --- | --- |
| Nik | `git switch -c feature/a3-auth-services` |
| Abel | `git switch -c feature/a3-dashboard-history-notifications` |
| Bryan | `git switch -c feature/a3-user-queue` |
| Heera | `git switch -c feature/a3-admin-queue` |

Commit coherent implementation stages with tests. Push with `git push -u origin
<your-branch>` on the first push; create reviewed PRs to main. Keep existing A2
feature branches intact. Agree on shared-file changes before editing them and
merge reviewed PRs one at a time. Re-run the backend checks and frontend lint/build
when integration changes either side.
