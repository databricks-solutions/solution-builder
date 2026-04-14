/**
 * Monaco-based read-only code viewer with syntax highlighting.
 */

import { useMemo, useEffect, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useTheme } from "@/components/layout/theme-provider";

// Configure Monaco to use local assets (important for Electron/offline)
loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
  },
});

interface CodeViewerProps {
  content: string;
  filename: string;
  className?: string;
  /** If true, the editor will fill its container's height instead of auto-sizing */
  fullHeight?: boolean;
}

/**
 * Map file extension to Monaco language identifier
 */
function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    py: "python",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    sh: "shell",
    bash: "shell",
    js: "javascript",
    ts: "typescript",
    tsx: "typescript",
    jsx: "javascript",
    html: "html",
    css: "css",
    xml: "xml",
    txt: "plaintext",
  };
  return languageMap[ext] || "plaintext";
}

export function CodeViewer({ content, filename, className, fullHeight }: CodeViewerProps) {
  const language = useMemo(() => getLanguage(filename), [filename]);
  const { theme } = useTheme();

  // Resolve the actual theme (handle "system" by checking document class)
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    if (theme === "system") {
      // Check the actual class on the document
      const isDark = document.documentElement.classList.contains("dark");
      setResolvedTheme(isDark ? "dark" : "light");

      // Also listen for system preference changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => setResolvedTheme(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    } else {
      setResolvedTheme(theme === "dark" ? "dark" : "light");
    }
  }, [theme]);

  // Calculate height based on line count (with min/max bounds) - only used when not fullHeight
  const lineCount = content.split("\n").length;
  const autoHeight = Math.min(Math.max(lineCount * 19 + 20, 200), 800);

  // Monaco theme: vs-dark for dark mode, light for light mode
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  return (
    <div className={`rounded-lg overflow-hidden border border-border ${fullHeight ? "h-full" : ""} ${className || ""}`}>
      <Editor
        height={fullHeight ? "100%" : autoHeight}
        language={language}
        value={content}
        theme={monacoTheme}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: "on",
          renderLineHighlight: "none",
          folding: true,
          wordWrap: "on",
          automaticLayout: true,
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          padding: { top: 12, bottom: 12 },
          domReadOnly: true,
          contextmenu: false,
        }}
        loading={
          <div className="flex items-center justify-center h-32 bg-muted/30">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        }
      />
    </div>
  );
}
