// Личные настройки вида сайта
export type ThemePref = "system" | "light" | "dark";
export type CardsPref = "auto" | "on" | "off";

export const VIEW_PREFS_EVENT = "bm-view-prefs";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem("bm-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(v: ThemePref) {
  try {
    if (v === "system") localStorage.removeItem("bm-theme");
    else localStorage.setItem("bm-theme", v);
  } catch {}
  const root = document.documentElement;
  if (v === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", v);
  window.dispatchEvent(new Event(VIEW_PREFS_EVENT));
}

export function getCardsPref(): CardsPref {
  try {
    const v = localStorage.getItem("bm-cards");
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setCardsPref(v: CardsPref) {
  try {
    if (v === "auto") localStorage.removeItem("bm-cards");
    else localStorage.setItem("bm-cards", v);
  } catch {}
  window.dispatchEvent(new Event(VIEW_PREFS_EVENT));
}
