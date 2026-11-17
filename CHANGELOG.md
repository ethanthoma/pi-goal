# Changelog

## 0.2.0 — 2026-11-17

- Resume a goal that hit its limits by granting additional turns or cost
  allowance. The prompt shows the new totals before confirmation; use
  `--add-turns N` and `--add-cost USD` with `/goal resume` to skip the prompts.
  Top-ups preserve usage history and are added to actual usage, including any
  cost overrun.
- Give stalled goals one recovery turn to try a different diagnostic or report
  a blocker, without overriding turn or cost limits. `/goal status` suggests
  the next step after a stall or budget stop.
- Revise a paused or blocked goal with `/goal revise <new objective>` without
  resetting usage or limits. The goal stays paused until resumed.

## 0.1.2

- Remove the default 50-turn cap for new goals. Use `--turns N` to set a cap
  explicitly.

## 0.1.1

- First npm release of `@ethanthoma/pi-goal`. Start, inspect, pause, resume, or
  clear goals saved with your Pi session. Goals stop on completion, blockers,
  stalled progress, or configured limits.
