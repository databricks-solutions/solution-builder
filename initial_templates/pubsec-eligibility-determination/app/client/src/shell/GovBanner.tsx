/**
 * The official-website banner every U.S. state site carries (USWDS "banner"
 * component): a grey strip stating the site is official, with a disclosure that
 * explains how to tell. Pure chrome — no data.
 */
import { useState } from 'react';

export function GovBanner() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#DFE1E2] bg-[#F0F0F0] text-[13px] text-[#1B1B1B]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-2 px-4 py-1.5">
        <span className="inline-flex size-4 items-center justify-center rounded-full bg-[#1B1B1B] text-[9px] font-bold text-white" aria-hidden>✓</span>
        <span>An official website of the State of Westbrook</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-1 cursor-pointer text-[#005EA2] underline underline-offset-2 hover:text-[#1A4480]"
        >
          Here’s how you know
        </button>
      </div>
      {open && (
        <div className="border-t border-[#DFE1E2] bg-white">
          <div className="mx-auto grid max-w-[1440px] gap-4 px-4 py-3 md:grid-cols-2">
            <div>
              <div className="font-semibold">Official websites use .gov</div>
              <div className="text-[#565C65]">A <b>.gov</b> website belongs to an official government organization in the United States.</div>
            </div>
            <div>
              <div className="font-semibold">Secure .gov websites use HTTPS</div>
              <div className="text-[#565C65]">A lock icon or <b>https://</b> means you’ve safely connected to the .gov website.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
