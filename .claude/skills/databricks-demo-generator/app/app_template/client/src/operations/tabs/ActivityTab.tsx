/**
 * Merged timeline of what's happened on this return.
 * Combines:
 *   - emails[]         (outgoing apologies, any incoming replies)
 *   - ai_audit_trail[] (approved/rejected/escalated/email_sent/note)
 *
 * Sorted newest-first by `at`. This is the replacement for the old
 * Emails + Coupons + Decision-history tabs combined.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  StickyNote,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { AuditEntry, EmailEntry, ReturnDetail } from '@/shared/types';

type TimelineItem =
  | ({ kind: 'email' } & EmailEntry)
  | ({ kind: 'audit' } & AuditEntry);

export function ActivityTab({ detail }: { detail: ReturnDetail }) {
  const items: TimelineItem[] = useMemo(() => {
    const emails = (detail.emails ?? []).map((e) => ({
      kind: 'email' as const,
      ...e,
    }));
    const audits = (detail.ai_audit_trail ?? []).map((a) => ({
      kind: 'audit' as const,
      ...a,
    }));
    return [...emails, ...audits].sort((a, b) =>
      (b.at ?? '').localeCompare(a.at ?? ''),
    );
  }, [detail]);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground max-w-md">
        Nothing's happened on this return yet. Once the assistant (or an
        operator) emails the customer, approves, or adds a note, it will
        show up here.
      </div>
    );
  }

  return (
    <ol className="space-y-3 max-w-3xl">
      {items.map((item, i) => (
        <li key={i}>
          {item.kind === 'email' ? (
            <EmailRow email={item} />
          ) : (
            <AuditRow audit={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

function EmailRow({ email }: { email: EmailEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isIncoming = email.direction === 'incoming';
  const Arrow = isIncoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors"
      >
        <div className="size-7 rounded-full bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)] flex items-center justify-center shrink-0">
          <Arrow className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium truncate">{email.subject}</div>
          <div className="text-xs text-muted-foreground truncate">
            {isIncoming ? 'from' : 'to'}{' '}
            {isIncoming ? email.from ?? '—' : email.to ?? '—'}
          </div>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {fmt(email.at)}
        </div>
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-border text-sm whitespace-pre-wrap leading-relaxed bg-background">
          {email.body}
        </div>
      )}
    </div>
  );
}

function AuditRow({ audit }: { audit: AuditEntry }) {
  const { icon, tone, label } = describe(audit.action);
  return (
    <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-start gap-3">
      <div
        className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${tone}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <span className="font-medium">{label}</span>
          {audit.notes && (
            <span className="text-muted-foreground"> · {audit.notes}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {audit.by}
          {audit.tool && ` · via ${audit.tool}`}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {fmt(audit.at)}
      </div>
    </div>
  );
}

function describe(action: AuditEntry['action']) {
  switch (action) {
    case 'approved':
      return {
        icon: <CheckCircle2 className="size-3.5" />,
        tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
        label: 'Approved',
      };
    case 'rejected':
      return {
        icon: <XCircle className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: 'Rejected',
      };
    case 'escalated':
      return {
        icon: <AlertTriangle className="size-3.5" />,
        tone: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
        label: 'Escalated',
      };
    case 'email_sent':
      return {
        icon: <MessageSquare className="size-3.5" />,
        tone: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
        label: 'Email sent',
      };
    default:
      return {
        icon: <StickyNote className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: action,
      };
  }
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
