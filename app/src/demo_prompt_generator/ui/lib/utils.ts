import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether a project file ships when the project is published as a template.
 * Mirrors the backend `_should_include_in_template` (template_service.py): a
 * template carries the WHOLE deployable demo — narrative, specs, code, DAB, app
 * source — and excludes only build/dep/state junk. Keep in sync with the backend.
 */
export function isTemplateEligible(relativePath: string): boolean {
  const parts = relativePath.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? relativePath;

  const JUNK_DIRS = new Set([
    ".claude", "node_modules", ".venv", "venv", "__pycache__", ".databricks",
    "dist", "build", ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "test-results", "playwright-report", "raw_data", ".turbo", ".next",
  ]);
  if (parts.some((seg) => JUNK_DIRS.has(seg))) return false;

  const JUNK_NAMES = new Set([
    ".env", ".ds_store", ".preview.pgid", ".preview.server.pid",
    "app.yaml.template", "template_screenshot.png",
  ]);
  if (JUNK_NAMES.has(name.toLowerCase())) return false;
  if (name.startsWith(".env.")) return false;

  const JUNK_EXTS = [
    ".pyc", ".pyo", ".so", ".o", ".class", ".log", ".tmp", ".zip",
    ".tar", ".gz", ".tgz", ".whl", ".map",
  ];
  if (JUNK_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) return false;

  return true;
}
