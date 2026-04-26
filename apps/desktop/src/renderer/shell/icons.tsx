import type { SVGProps } from "react";

/** Feather-style inline icons so we have no image/icon-font dep. */

export function MicIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x={9} y={2} width={6} height={12} rx={3} />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function SendIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2z" />
    </svg>
  );
}

export function CloseIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CopyIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x={9} y={9} width={13} height={13} rx={2} />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function RedoIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="21 8 21 3 16 3" />
      <path d="M21 3 12 12" />
      <path d="M20 12a8 8 0 1 1-8-8" />
    </svg>
  );
}

export function ChatIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function FollowUpIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function GearIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function SparkleIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2 13.7 8.3 20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" />
    </svg>
  );
}
