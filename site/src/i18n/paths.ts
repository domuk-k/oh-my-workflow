// Locale-aware path helpers. `en` is the default locale (no prefix); `ko` is
// served under `/ko`. Direct functions — no barrel re-exports.

export type Lang = "en" | "ko";

const GITHUB = "https://github.com/domuk-k/oh-my-workflow";

export function homeHref(lang: Lang): string {
  return lang === "ko" ? "/ko/" : "/";
}

export function docsHref(lang: Lang): string {
  return lang === "ko" ? "/ko/docs" : "/docs";
}

export function githubHref(): string {
  return GITHUB;
}

export function skillHref(): string {
  return `${GITHUB}/blob/main/skill/SKILL.md`;
}

export function otherLang(lang: Lang): Lang {
  return lang === "ko" ? "en" : "ko";
}

// Same page, other language. `page` is "home" | "docs".
export function switchLangHref(lang: Lang, page: "home" | "docs"): string {
  const target = otherLang(lang);
  return page === "docs" ? docsHref(target) : homeHref(target);
}
