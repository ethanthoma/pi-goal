# pi-goal

Give Pi a goal and let it keep working across turns. It stops when it reports
completion, needs your input, stops making progress, or reaches a limit.

## Get started

Install from GitHub and restart Pi:

```sh
pi install git:github.com/ethanthoma/pi-goal
```

Or load it from a local checkout:

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

## Publishing

The npm package name is `@ethanthoma/pi-goal`. Authenticate with an npm account
that can publish under the `@ethanthoma` scope:

```sh
npm login
npm publish --dry-run
npm publish
```

Publishing runs the checks and tests below. After release, users can install
with `pi install npm:@ethanthoma/pi-goal`.

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
