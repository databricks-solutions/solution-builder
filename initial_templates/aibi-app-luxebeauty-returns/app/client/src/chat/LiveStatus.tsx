/**
 * Rotating "the agent is working" ticker. Pure flavor — cycles through a
 * list of generic high-level phrases every ~2s so the user feels there's
 * real work happening while the answer streams in the background.
 */
import { useEffect, useState } from 'react';

const PHRASES = [
  'Thinking…',
  'Querying data…',
  'Scanning documents…',
  'Cross-referencing knowledge base…',
  'Analyzing patterns…',
  'Reading incident reports…',
  'Crunching numbers…',
  'Drafting a response…',
];

export function LiveStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % PHRASES.length), 2000);
    return () => clearInterval(t);
  }, []);

  const text = PHRASES[i];

  return (
    <div className="relative h-5 overflow-hidden">
      <div
        key={text}
        className="text-xs text-muted-foreground italic leading-snug animate-[fadeSlide_0.4s_ease-out]"
      >
        {text}
      </div>
      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
