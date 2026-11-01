const KEY = "theme";

export function initTheme() {
  const saved = localStorage.getItem(KEY);
  const theme =
    saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
  return theme;
}

export function setTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

export function getTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
