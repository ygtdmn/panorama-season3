// Server-safe home for the pre-paint theme bootstrap. layout.tsx (a server component) must
// not import this from ThemeProvider: importing a value from a "use client" module there
// yields a client-reference stub, and the inline script silently serializes to junk.

export const THEME_STORAGE_KEY = "panorama-auction-theme";

// Season 3 is dark only: the class is fixed so `dark:` variants and the tokens always agree.
export const themeInitScript = `document.documentElement.classList.add("dark");`;
