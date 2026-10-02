# data-bp (Analytics)

## Styling comes from basket-tv-ui

The shell and the look shared by the basket-app.com apps live in one package, [`basket-tv-ui`](https://github.com/WencesCapolo/basket-tv-ui): the design tokens (`--n-*`, `--accent*`, `--ok*`, `--navy*`, `--border`, `--panel-radius`, shadows, fonts), the `Marco` shell (navy sidebar, header, Volver / Elegir aplicación), `ChipDeUsuario`, `BotonDeSalir` and `urlDelLanzador`.

- Use the package; don't add general styling here. That means no new `:root` colour, radius, shadow or font tokens, no hardcoded palette hex values (use `bg-accent`, `text-n-600`, `var(--border)`…), and no local copies or variants of the shell, the user chip or the logout button.
- If something general is missing (a token or a shell slot that another app would also want), add it to `basket-tv-ui`: change `src/`, run `pnpm build`, commit `src` and `dist` together, tag `vX.Y.Z`, then bump the `#vX.Y.Z` in this app's `package.json`.
- Only styling specific to this app belongs here, next to the `@import 'basket-tv-ui/estilos.css'`.
- Analytics' own styling: the utilities in `src/app/globals.css` (`card`, `card-title`, `eyebrow`, `figure`, `pill`, `segmented`, `tag-*`, `data-table`…), the primitives in `src/components/ui` (Card, KpiCard, PillGroup, SegmentedTabs, PageTitle…), and the chart colours in `src/lib/client/palette.ts` (Chart.js paints on a canvas and can't read CSS variables). Light only.
