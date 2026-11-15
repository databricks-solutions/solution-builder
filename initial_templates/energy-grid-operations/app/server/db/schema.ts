/**
 * Chat-state types. This demo keeps conversations IN MEMORY (see ./index.ts):
 * the durable, auditable write-back is the Delta table `operator_actions`
 * (written through the SQL warehouse, see lib/sql.ts + routes/grid.ts), so the
 * app needs no Lakebase instance. A conversation lives until the app restarts.
 */
export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };

export type Conversation = {
  id: string;
  userEmail: string;
  title: string;
  kind: 'default' | 'demo_dock';
  createdAt: Date;
  updatedAt: Date;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  position: number;
  traceId: string | null;
  thinking: ThinkingEntry[];
  error: string | null;
  canceled: boolean;
  createdAt: Date;
};
