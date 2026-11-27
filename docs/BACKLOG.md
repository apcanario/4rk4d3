# RLX: backlog

Rows are defined in docs/V2.md. Nothing is built that is not a row here. A done row leaves the Queue.

## Queue

## Done

- PF1 (2026-11-27): `portfolio/`, the case study folder for `apcanario/portfolio` (story, ten decisions in review, IA and decision diagrams, v2 screens). Docs and one test line only; no shipped file changed.

- V2 (2026-11-27): v1 archived at branch `archive/v1`; main is Bricks and Pool only (docs/V2.md). Headless only; nothing confirmed on a phone.

## Proposed

- Phone: pull length for full power (`pullCapPx` 20 in `games/pool/pool.js`): does 20 logical px (about 53 CSS px) feel like little thumb travel?
- Phone: break strength (`launchSpeed` 300): does a full pull break the rack hard enough, not too hard?
- Phone: how long balls roll (`decel` 38): too long a wait before the next shot, or too short?
- Phone: pocket size (corner radius 9, side radius 8): too generous, too tight?
- Phone: haptics told apart (release 10 ms, ball 6, cushion 4, pot 24, new rack 30; the shared 40 ms gate may drop a quiet one after a loud one).
- Phone: the two-card hub (Bricks left, Pool right, low in the thumb's reach): taps land, the Pool card reads as a table.
- Phone: dark on the device (Pool's table and pocket rings, the hub, at night).
- Tag `v1` is missing: the session's proxy refused tag pushes and the GitHub API write. Branch `archive/v1` holds the same commit (`b8209ba`). From a computer: `git fetch origin archive/v1 && git tag -a v1 -m "RLX v1: hub and five games (Bricks, Catch, Putt, Stack, Glide)" b8209ba && git push origin v1`.
- Play listing: `docs/play/` screenshots and listing text name five games and are stale. Not redone (the Play account is on hold).
- Phone: the living hub (`hub/life.js`, `LIFE`): pace, too busy or too calm, battery.
