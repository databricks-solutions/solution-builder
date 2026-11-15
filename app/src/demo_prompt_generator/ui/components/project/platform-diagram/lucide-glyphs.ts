/**
 * platform-diagram/lucide-glyphs — the component behind each `lucide:<name>` icon
 * key. The NAMES are owned by lib/platform-architecture (LUCIDE_GLYPH_NAMES, which
 * the skill catalog prints); this map is typed against them, so a name without a
 * component (or a component without a name) fails the type check.
 *
 * Glyphs are monochrome line icons, so callers colour them like text (`currentColor`).
 */
import {
  Activity, AlertTriangle as TriangleAlert, Bell, Bot, Box, Brain, BarChart3, Building2,
  Calendar, Cloud, Code, Cpu, Database, File as FileGlyph, FileText, Filter, Folder, Gauge,
  GitBranch, Globe, HardDrive, Key, Layers, LineChart, ListChecks, Lock, Mail, MessageSquare,
  Monitor, Network, Package, PieChart, Radio, Rocket, Scale, Search, Server, Settings,
  Shield, Smartphone, Sparkles, Table, Terminal, User, Users, Webhook, Workflow, Zap, Clock,
  CheckCircle as CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { lucideGlyphName, type LucideGlyphName } from "@/lib/platform-architecture";

export const LUCIDE_GLYPHS: Record<LucideGlyphName, LucideIcon> = {
  "sparkles": Sparkles,
  "list-checks": ListChecks,
  "database": Database,
  "server": Server,
  "cloud": Cloud,
  "file": FileGlyph,
  "file-text": FileText,
  "folder": Folder,
  "user": User,
  "users": Users,
  "lock": Lock,
  "key": Key,
  "shield": Shield,
  "bell": Bell,
  "mail": Mail,
  "globe": Globe,
  "cpu": Cpu,
  "zap": Zap,
  "workflow": Workflow,
  "git-branch": GitBranch,
  "table": Table,
  "bar-chart-3": BarChart3,
  "line-chart": LineChart,
  "pie-chart": PieChart,
  "layers": Layers,
  "box": Box,
  "package": Package,
  "settings": Settings,
  "terminal": Terminal,
  "code": Code,
  "message-square": MessageSquare,
  "bot": Bot,
  "brain": Brain,
  "search": Search,
  "filter": Filter,
  "clock": Clock,
  "calendar": Calendar,
  "alert-triangle": TriangleAlert,
  "check-circle": CircleCheck,
  "webhook": Webhook,
  "radio": Radio,
  "activity": Activity,
  "smartphone": Smartphone,
  "monitor": Monitor,
  "building-2": Building2,
  "network": Network,
  "hard-drive": HardDrive,
  "gauge": Gauge,
  "scale": Scale,
  "rocket": Rocket,
};

/** The glyph component for a `lucide:<name>` key, or undefined when the key is not
 *  a curated glyph (callers fall back to their default icon). */
export function lucideGlyphComponent(key: string | undefined | null): LucideIcon | undefined {
  const name = lucideGlyphName(key);
  return name ? LUCIDE_GLYPHS[name] : undefined;
}

/** The default look of a `lucide:<name>` glyph everywhere it renders (logos, card
 *  and box title icons, BrandMark): thin strokes in a muted slate, so a generic
 *  pictogram sits quietly beside the source logos. A node's explicit colour (`style`
 *  or `textColor`) still wins — it is spread after these defaults. */
export const LUCIDE_GLYPH_STROKE = 1.25;
export const LUCIDE_GLYPH_INK = "#64748B";
