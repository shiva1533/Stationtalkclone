# Project memory

## Product intent & audience

- Real-time social hangout platform with virtual city-based rooms, live voice, text chat, temporary identities, and multiplayer games.
- Target: casual users joining drop-in social rooms; mobile and desktop expected.
- Must feel production-ready and polished, not a demo or template.

## Brand personality & voice

- Social, playful, inviting; oriented around presence and conversation.
- UI labels and feedback should be concise and human-friendly.

## Visual design & UX direction

- Built with Vite + React, Tailwind CSS, Lucide React icons; use `@/` import alias for `src/`.
- No extra UI/icon theme packages unless explicitly requested.
- Aesthetic should be distinctive, not cookie-cutter; production-quality visual polish.
- Mobile responsiveness is a priority: avoid overlap, ensure adequate touch targets and spacing.
- Established color palette (shared across landing page and junction/room pages):
  - Deep navy backgrounds for primary surfaces.
  - Violet for actions, highlights, and primary accents.
  - Soft sky tones for secondary accents.
  - Emerald used as an additional accent tone.
  - Consistent panel surfaces across chat, participants, controls, dialogs, and stage.
- Reaction/emoji picker pattern: fixed 5-column grid, 2 rows max, horizontally constrained, evenly spaced, larger touch-friendly buttons, no emoji overlap.
- Prefer grid-based layouts for icon/emoji rows to enforce consistent columns and spacing.

## Decisions, constraints & rationale

- Unified the junction (individual room) page to use the same palette as the landing page; replaced earlier slate/indigo surfaces and accents with navy/violet/sky/emerald system for visual consistency across the app.
- Emoji reaction panel constrained to 5 per row × 2 rows to prevent overlap on small screens and keep the picker compact.
- Wider container and consistent spacing chosen to improve mobile usability and visual balance.
- App must continue to type-check and build successfully after UI changes.
- Authoritative global instructions live in `.bolt/prompt`; memory does not restate them.

## Open questions & assumptions

- Exact emoji set for the picker not yet confirmed; currently inferred from existing implementation.
- Typography scale and detailed component library conventions still emerging from ongoing design requests.
- City-based room UI, voice participant layout, and multiplayer game surfaces not yet detailed in memory.
- Palette is now consistent across landing and junction pages, but full token/systematization (e.g., shared Tailwind config aliases or theme variables) not yet confirmed.