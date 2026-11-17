# pi-goal

Give Pi a goal and let it keep working across turns. It stops when it reports
completion, needs your input, stops making progress, or reaches a limit.

## Get started

From this checkout, load the extension:

```sh
pi --extension ./index.js
```

Then give it a goal:

```text
/goal --turns 50 --cost 5 Fix the failing tests and verify the changes
```

`--turns` limits model responses (default: 50). `--cost` sets an optional dollar
limit using provider-reported prices. Limits are checked after each response, so
a request already in flight can exceed the cost limit.

## Commands

| Command             | Action                            |
| ------------------- | --------------------------------- |
| `/goal <objective>` | Start a goal                      |
| `/goal status`      | Show the goal and usage           |
| `/goal pause`       | Stop automatic continuation       |
| `/goal resume`      | Continue a paused or blocked goal |
| `/goal clear`       | Remove the goal                   |

Goals are saved with your session and stay paused when you reopen it. Resuming
keeps the same usage totals. Start a new goal if you need a larger budget.

Pi is instructed to verify its work before reporting completion, but you should
still review the result. Progress detection is heuristic: repeated workspace
states or similar tool output can cause it to stop even when work remains.

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
