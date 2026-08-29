# ASSET INVENTORY (visual/audio)

Source repo inspected: `bryanxbt/coinup` (MIT — Build Together Labs), local
clone `~/coinup`, audited 2026-08-28. Nothing is imported at build time;
reused items are copied into `public/` with attribution below when adopted.

| Asset | Source | Path/URL | Type | Reuse? | Reason | License notes |
|---|---|---|---|---|---|---|
| Chip the Arcade Manager (16-256px set) | coinup | `public/images/chip-arcade-manager*.png` | pixel mascot | YES (lobby host) | shared arcade identity | MIT repo |
| Brand palette + pixel law | coinup brand book | `docs/brand-book/05,07` | design tokens | YES | family consistency | MIT repo |
| Press Start 2P | Google Fonts | fonts.google.com | font | YES | scoreboard type | OFL |
| Inter | Google Fonts | fonts.google.com | font | YES | body/HUD fine print | OFL |
| CRT shell CSS (scanlines, pixel-panel/btn) | coinup | `src/app/globals.css` | CSS treatment | ADAPT (rewrite) | cabinet feel without importing their stylesheet | MIT repo |
| Jack the Dealer + card-room kit (cards, chips, felt) | coinup | `public/images/card-room/*` | sprites | NO | Floor-2 casino identity — wrong game | — |
| Crazy Wheel canvas art (segments, wheel) | coinup | `src/games/crazy-wheel/*` | canvas code/art | NO | spec forbids; wheel-specific | — |
| Arch logo/marks | arch.network | site assets | brand | NO (unless permission) | never fabricate/misuse official marks; use text "ARCH TESTNET" | unverified license |
| Bitcoin ₿ glyph | Unicode | — | glyph | YES | universal symbol | n/a |
| Sound effects | none exist in coinup | — | audio | CREATE | no prior audio layer anywhere | new, original/CC0 |
| Player sprites (8 palette swaps) | NEW | `public/sprites/players/` | pixel art | CREATE | arena runners don't exist yet | original |
| Loot crates/chips (S/M/L, UTXO-crate motif) | NEW | `public/sprites/loot/` | pixel art | CREATE | core game objects | original |
| Arena tiles, walls, bank/vault zone | NEW | `public/sprites/arena/` | pixel art | CREATE | the map itself | original |
| HUD frames, result screens, countdown numerals | NEW | `public/sprites/ui/` | pixel art | CREATE | game-specific chrome | original |

Rule: anything not marked YES/ADAPT is not used. New art follows the pixel
law (1px = 1 solid hex, no AA, nearest-neighbor, 16/32/64 sizes).
