# krites

> κριτής — "judge / critic." The reviewer/merger that closes the kleroterion loop.

**Krites** is an autonomous CLI that reviews the pull requests [Praktor](https://github.com/kleroterionlabs/praktor)
opens — checking each PR against the acceptance criteria of the [Boule](https://github.com/kleroterionlabs/boule)
Task it implements, plus code quality, tests, and security — posts a GitHub review, and (when satisfied)
enables **gated auto-merge**. It is built on [@kleroterion/koine](https://github.com/kleroterionlabs/koine)
and is the third stage of the pipeline:

```
Boule (grooms backlog: Designs → Requirements → Tasks)
  → Praktor (implements a ready Task, opens a PR)
    → Krites (reviews the PR, approves, enables gated auto-merge)   ← you are here
```

## Safety model

Krites can influence merges to the default branch, so it is deliberately conservative:

- **Branch protection is the real gate.** Krites is granted no Administration scope and never force-merges.
  It posts an approving review and merges via the REST API **pinned to the reviewed SHA**; with no bypass,
  GitHub branch protection still enforces required checks/reviews server-side and rejects the merge if they
  are unmet (a 405/409 is handled as "not yet", never a crash). Both `doctor` and the deterministic
  `canMerge` gate refuse to proceed if branch protection is absent.
- **The LLM is advisory only.** The reviewer is read-only and returns a strict, fenced verdict. A
  deterministic, default-deny `canMerge` predicate — not the model's prose — is the sole authority on
  whether auto-merge is enabled. All PR content (diff, title, body, comments) is treated as **untrusted
  data**, never as instructions.
- **Trusted-author only.** Auto-merge is enabled only for PRs authored by the trusted Praktor bot
  identity (verified by login, not a user-settable label) that link a `boule:managed` `kind:task`.
- **Bounded blast radius.** A per-run merge cap (`KRITES_MAX_MERGES`, default 1), single-concurrency
  workflow, SHA-pinned review (a force-push under the claim invalidates it), live `boule:halt` re-poll
  before enabling merge, and `--dry-run` for safe planning.
- **Own, least-privilege identity.** Krites uses its own GitHub App with no Administration scope, so it
  cannot edit its own branch protection or CI workflows.

## Commands

```
krites doctor     # preflight: config, credentials, repo + Discussion categories, merge-capability,
                  # and branch-protection probe (fails if protection is absent)
krites next       # list reviewable PRs (trusted-author, linked Task, not draft/merged/reviewed)
krites status     # pipeline snapshot: candidate / approved / changes-requested PRs + active claims
krites review     # claim → review → post review → gated auto-merge-enable for one PR
```

Global flags: `--repo`, `--project`, `--budget`, `--max-turns`, `--dry-run`, `--json`, `--verbose`.

## Configuration

See [`.env.example`](./.env.example). Krites resolves its GitHub identity from the `KRITES_APP_*` trio
(preferred) or a `KRITES_GITHUB_TOKEN` / `GITHUB_TOKEN` PAT fallback. Behaviour knobs (`KRITES_MERGE_METHOD`,
`KRITES_REQUIRE_CI`, `KRITES_MAX_MERGES`, `KRITES_TRUSTED_AUTHOR`) are validated by a zod schema with safe
defaults.

## License

MIT © Bill Schumacher
