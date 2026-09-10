export const jsonPalettes = [
  { id: "firefox", label: "Firefox" },
  { id: "github", label: "GitHub" },
  { id: "dracula", label: "Dracula" },
] as const;

export type JSONPalette = (typeof jsonPalettes)[number]["id"];

const storageKey = "validex.json-palette";
let activePalette: JSONPalette = "firefox";

export function isJSONPalette(value: unknown): value is JSONPalette {
  return jsonPalettes.some((palette) => palette.id === value);
}

export function getJSONPalette(): JSONPalette {
  try {
    const saved = localStorage.getItem(storageKey);
    if (isJSONPalette(saved)) activePalette = saved;
  } catch {
    // Keep the current preference when browser storage is unavailable.
  }
  return activePalette;
}

export function setJSONPalette(palette: JSONPalette): void {
  activePalette = palette;
  try {
    localStorage.setItem(storageKey, palette);
  } catch {
    // The palette still works for this session if storage is blocked.
  }
}
