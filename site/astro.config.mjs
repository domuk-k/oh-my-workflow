import { defineConfig } from "astro/config";

// Static site. `en` is the default locale served at the root (`/`, `/docs`);
// `ko` is prefixed (`/ko/`, `/ko/docs`). GitHub Pages-friendly when `site`/`base`
// are set at deploy time; left unset for local `astro dev`/`preview`.
export default defineConfig({
  i18n: {
    locales: ["en", "ko"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
});
