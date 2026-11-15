import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/** A `?theme=` URL param lets a link pin the theme (e.g. an embed/screenshot
 *  or a shared deep link): `?theme=dark`, `?theme=light`, `?theme=system`.
 *  When present it WINS over the stored preference on load and is persisted,
 *  so the choice sticks even after the param is dropped from the URL.
 *  Returns null for a missing/invalid value. */
function readThemeFromUrl(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URLSearchParams(window.location.search)
      .get("theme")
      ?.toLowerCase();
    if (value === "dark" || value === "light" || value === "system") {
      return value;
    }
  } catch {
    // URL unavailable / unparsable — fall back to the stored preference.
  }
  return null;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    // A `?theme=` URL param overrides the stored preference and is persisted
    // so it sticks across in-app navigation (which drops the query string).
    const urlTheme = readThemeFromUrl();
    if (urlTheme) {
      localStorage.setItem(storageKey, urlTheme);
      return urlTheme;
    }
    return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
