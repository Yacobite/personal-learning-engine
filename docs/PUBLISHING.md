# Publishing this portfolio project

This is a Markdown guide, not a PowerShell script. Run only the commands inside the code blocks, one line at a time. Do not paste headings, tables, the opening/closing triple backticks, or a terminal prompt such as `PS C:\...>` into PowerShell. Stop at the first error rather than continuing with later steps.

## File inclusion review

The project already has a Git repository and development history. At preparation time its branch was `master`, it had no remote, and the Obsidian integration was present as uncommitted changes. Keep that implementation and its tests together in the publishing commit.

| Include | Reason |
| --- | --- |
| `src/` and `.pi/extensions/index.ts` | Application implementation and the Pi entry point. Do not ignore all of `.pi/`. |
| `tests/` and its helper fixtures | Synthetic examples and evidence of engineering coverage. |
| `package.json`, `package-lock.json`, `tsconfig.json` | Reproducible dependencies, scripts and strict TypeScript configuration. Keep the lockfile. |
| `README.md` and `docs/` | Portfolio introduction, usage reference, design decisions and milestone validation records. |
| `scripts/` | Local acceptance harnesses; some require private inputs and are separate from public CI. |
| `.github/workflows/ci.yml` and `.gitignore` | Automated checks and publication exclusions. |
| `sources/examples/boolean-logic.md` and `sources/inbox/.gitkeep` | A public synthetic demo and an empty private-input directory. |

| Exclude | Reason |
| --- | --- |
| `node_modules/` | Reinstall from the lockfile. |
| `_learning/` | Private SQLite data, responses, extracted text, reports, Obsidian vault and annotations. |
| `.cache/`, coverage, logs and build metadata | Reproducible or local output. |
| Learner files under `sources/` | Private/copyrighted course material. Only the named demo and inbox keep file are allowed by default. |
| `.env*`, private keys and Pi local settings/session files | Credentials and local configuration; the extension source remains included. |
| `obsidian-v1-review.diff` | A generated review snapshot that duplicates implementation and is no longer current after the README rewrite. |
| Editor and OS files | Local preferences and noise. |

Preparation checks found no obvious credential patterns or private learning-file paths in the public candidate files or the ten existing commits. One credential-pattern match was a synthetic `task-<UUID>` test ID. This was a targeted pattern/path review, not a guarantee that every possible secret format was detected. Ignoring a file does not remove a previously committed copy; review the staged files before publishing.

No license was selected on your behalf. The package's `private: true` setting prevents accidental npm publication and can stay as-is for a GitHub portfolio repository.

## 1. Review locally

Open PowerShell and enter the project directory. The quotes are needed because the folder name contains a space:

```powershell
Set-Location -LiteralPath 'C:\Users\yaqub\coding\learning bot'
node --version
npm.cmd --version
```

Use `npm.cmd` in PowerShell: it invokes npm's Windows command wrapper directly and avoids the `npm.ps1 cannot be loaded because running scripts is disabled` error. No execution-policy change is needed.

Check Git access:

```powershell
git status --short
```

If Git reports **dubious ownership**, first confirm this is your intended local checkout. The preparation session encountered that error and used a per-command safe-directory override without changing global configuration. To trust just this checkout in your own terminal, run this line, then retry `git status --short`:

```powershell
git config --global --add safe.directory 'C:/Users/yaqub/coding/learning bot'
```

Once Git access works, install and validate:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run check
```

The local validation result during preparation was strict TypeScript plus **332 passing tests** on Windows with Node 24.19.0. Restricted environments may block the tests' temporary-file renames, junctions or loopback HTTP server; run in a normal local terminal if that happens.

Review your commit identity. These commands display the configured values:

```powershell
git config user.name
git config user.email
```

If either is blank, configure it before committing, using your own name and GitHub email. The configured email will be attached to the commit.

## 2. Stage and inspect the portfolio files

The following stages the implementation, including the existing Obsidian work, and the portfolio preparation:

```powershell
git add .gitignore .github .pi/extensions/index.ts README.md docs package.json package-lock.json tsconfig.json src tests scripts sources/inbox/.gitkeep sources/examples/boolean-logic.md
git diff --cached --name-only
git diff --cached --stat
git diff --cached --check
```

Review the full staged diff locally with `git diff --cached`. The excluded directories and generated patch above should not appear. Then commit:

```powershell
git commit -m "Prepare learning engine portfolio with Obsidian integration"
```

## 3. Create an empty GitHub repository

Sign in to GitHub and [create a repository](https://github.com/new). Suggested name: `personal-learning-engine`.

Suggested description:

> TypeScript learning assistant with source-grounded curricula, SQLite evidence history, deterministic review scheduling and Obsidian export.

Select **Public** when you are ready for CV readers to see it. Leave **Add a README**, **Add .gitignore** and **Choose a license** unselected for this initial upload, because you are pushing an existing local repository. A license can be chosen separately.

This follows [GitHub's instructions for an existing local repository](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

## 4. Connect and push

First check your branch and remotes:

```powershell
git branch --show-current
git remote -v
```

If your branch is `master`, rename it with the next command. Skip this command if it is already `main`:

```powershell
git branch -m main
```

Copy the HTTPS URL from your newly created GitHub repository. In the next command, replace `YOUR_USERNAME` with your actual username, and change the repository name if you chose another one. Keep the URL in quotes; do not wrap your username in angle brackets.

If `git remote -v` showed no `origin`, run:

```powershell
git remote add origin 'https://github.com/YOUR_USERNAME/personal-learning-engine.git'
git remote -v
```

If `origin` already exists, skip `git remote add`. Verify its URL matches the repository you intend to publish. If it is wrong, correct it with `git remote set-url origin 'YOUR_ACTUAL_REPOSITORY_HTTPS_URL'`, substituting the real URL first.

When the branch and remote are correct, push:

```powershell
git push -u origin main
```

Authenticate through Git Credential Manager if prompted. If `origin` already exists by the time you follow this guide, inspect it with `git remote -v` and use the intended remote rather than adding another one. Do not force-push.

If your branch is already named `main`, skip the rename. If Git reports that another `main` branch already exists, stop and inspect `git branch` before changing branches. After the first push, ordinary `git push` sends future commits to the configured upstream.

### Common errors

| Message | Next step |
| --- | --- |
| `npm.ps1 cannot be loaded` / `running scripts is disabled` | Use `npm.cmd` as above. |
| `Unexpected token`, `Missing expression`, or an error mentioning backticks / `<` | Paste just one command from a code block, without Markdown fences or terminal prompts. Replace placeholders before running. |
| `not a git repository` or `ENOENT ... package.json` | Run the quoted `Set-Location` command at the start of this guide. |
| `detected dubious ownership` | Follow the checkout-specific trust step above, then retry. |
| `remote origin already exists` | Inspect `git remote -v`; skip adding it again if it is correct. |
| `src refspec main does not match any` | Check `git branch --show-current` and `git log -1 --oneline`; confirm the commit exists and the branch is `main`. |
| `Repository not found` / authentication failure | Verify the repository exists, the remote URL has your real username, and you authenticated to the account with access. |
| Push rejected as `non-fast-forward` | Stop and inspect the remote history; do not force-push. The remote may have been initialized with its own README or license. |

Warnings that `LF will be replaced by CRLF` describe Git's line-ending conversion and do not mean staging failed. A diff may open in a pager; press `q` to return to PowerShell.

## 5. Check the public result

Open the repository and confirm the README renders, its relative links work, the public demo is present, and private learning material is absent. Check the **Actions** tab for the **Checks** workflow. It installs with `npm ci --ignore-scripts` and runs `npm run check` on Windows; its first hosted execution has not been verified locally.

The workflow uses GitHub's [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) actions with read-only repository permissions.

Set `main` as the default branch if GitHub has not selected it. Add relevant repository topics such as `typescript`, `sqlite`, `learning`, `obsidian` and `llm`. Pin the repository on your profile and link it from your CV.

Suggested CV description:

> Personal Learning Engine — TypeScript/Pi assistant with versioned source ingestion, curriculum graphs, auditable SQLite assessment history and deterministic review scheduling; covered by 332 automated tests.

If you add a screenshot later, create it with the public demo and synthetic answers so it contains no private course or learner data.
