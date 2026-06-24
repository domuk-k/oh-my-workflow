# @oh-my-workflow/site

Marketing landing (`/`) + docs (`/docs`) for oh-my-workflow. Astro static site,
bilingual (en default, `ko` under `/ko`). Private workspace member — never published
to npm.

```sh
bun install            # from the repo root (workspace), or in this dir
bun --filter @oh-my-workflow/site dev      # dev server
bun --filter @oh-my-workflow/site build    # static build → site/dist
```

- Landing copy + docs copy live in `src/i18n/en.json` / `src/i18n/ko.json` — keep
  the two key-for-key in sync. Code blocks are language-neutral and live in the
  components.
- `teach`-style explainer content is intentionally **not** here — it belongs in a
  standalone post, not the product docs.
