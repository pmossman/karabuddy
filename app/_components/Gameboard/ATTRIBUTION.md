# Attribution

The renderer components in this tree are adapted from
[karabast/forceteki-client](https://github.com/karabast/forceteki-client)
(MIT License, Copyright (c) 2024 Dan Bastin and contributors).

See `~/code/karabast-dev/forceteki-client/LICENSE` for the original notice.

The original source files were copied wholesale and then modified to:

- Drop the live socket.io game connection (`Game.context.tsx`)
- Stub out `next-auth` (`User.context.tsx`, `app/_stubs/next-auth.ts`)
- Stub out the karabast backend (`ServerApiService`, `ServerAndLocalStorageUtils`)
- Remove unused chat/lobby/preferences overlays

Modifications by karabuddy contributors. Re-enable sections marked
`TODO(karabuddy)` when wiring up the full replay-driver.
