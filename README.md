# pi-goal

Give Pi a goal and let it keep working across turns. It stops when it reports
completion, needs your input, stops making progress, or reaches a limit.

## Get started

Install from npm and restart Pi:

```sh
pi install npm:@ethanthoma/pi-goal
```

Or load it from a local checkout:

```sh
pi --extension ./index.js
```

Then give it a goal:

```text
/goal --turns 50 --cost 5 Fix the failing tests and verify the changes
```

There is no default turn limit. Use `--turns` to cap model responses.
`--cost` sets an optional dollar
limit using provider-reported prices. Limits are checked after each response, so
a request already in flight can exceed the cost limit.

## Commands

| Command             | Action                            |
| ------------------- | --------------------------------- |
| `/goal <objective>` | Start a goal                      |
| `/goal status`      | Show the goal and usage           |
| `/goal pause`       | Stop automatic continuation       |
| `/goal resume`      | Continue a paused or blocked goal |
| `/goal revise <new objective>` | Revise a paused or blocked goal |
| `/goal clear`       | Remove the goal                   |

To revise an active goal, pause it first and wait for Pi to become idle. Revising
keeps the same goal, usage, and limits. It leaves the goal paused until you resume.

Goals are saved with your session and stay paused when you reopen it. Resuming
keeps the same usage totals. In interactive Pi, `/goal resume` asks for an
additional allowance for each exhausted limit and shows the new totals before
you confirm. The allowance is added to actual usage, including any cost overrun.
Canceling leaves the goal unchanged. To skip the prompts, use
`/goal resume --add-turns 10 --add-cost 2.00`. Supply a flag for each exhausted
limit and omit flags for other limits. The flags authorize the top-up without
confirmation; if any allowance is missing or invalid, nothing changes.

Completion requires a fresh-context review using the current model and read-only
workspace tools. The reviewer compares the full user objective with the worker's
claimed evidence, looking for omitted requirements and completed slices presented
as finished products. Unfinished work is returned to the agent; an unavailable,
interrupted, or invalid review blocks completion rather than accepting it.

Review uses an ephemeral session without discovered extensions, skills, or project
instructions. It can read/search files but cannot run tests or modify the workspace.
Review responses and provider-reported cost count against the goal's existing
limits. Each review is bounded to eight responses and two minutes, with no automatic
request retries. Requests already in flight can exceed a limit. No separate model
configuration is needed, but reviews incur additional model usage.

Independent review is still model judgment, not proof: it can miss requirements,
misread evidence, or encounter misleading workspace content. You should still
review the result. Progress detection is heuristic: repeated workspace
states or similar tool output can cause it to stop even when work remains.

## Publishing

Releases publish through GitHub Actions using npm trusted publishing. No npm
token is stored in GitHub.

One-time setup in the npm package settings, under Trusted Publisher:

- Provider: GitHub Actions
- Owner: `ethanthoma`
- Repository: `pi-goal`
- Workflow filename: `publish.yml`
- Environment: leave empty
- Allow direct publishing with `npm publish` if this option is shown

The package must already exist on npm. Push the workflow to `main` before
releasing. For each release, update the version and lockfile, commit and push
the changes, then push a matching tag:

```sh
npm version 0.1.1 --message "chore: release %s"
git push origin main
git push origin v0.1.1
```

The workflow checks that the tag matches the package version and belongs to
`main`. It runs checks and tests before publishing with provenance.

## Development

Requires Node 20.11+, npm, and `pi` on PATH.

```sh
npm ci
npm run check
npm test
```

Tests use [Hegel](https://hegel.dev/) to exercise budgets, accounting,
continuation cancellation, and stalls. A Pi RPC smoke check verifies that the
extension loads. Tests make no model requests. Provider and interactive UI
behavior are not covered.

## License

Licensed under either [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at
your option.
