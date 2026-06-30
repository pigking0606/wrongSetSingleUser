// Minimalist stroke-based SVG icons (24x24, stroke-width 2)
// Designed for clear semantic association with their labels

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconFlame({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M12 2c-2 5-5 8-5 12a5 5 0 0 0 10 0c0-4-3-7-5-12Z" />
    <path d="M12 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </svg>;
}

export function IconChart({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M3 20h18" />
    <path d="M7 20V12" />
    <path d="M12 20V6" />
    <path d="M17 20v-4" />
  </svg>;
}

export function IconTrending({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="3 17 9 11 13 15 21 7" />
    <polyline points="15 7 21 7 21 13" />
  </svg>;
}

export function IconPencil({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 3 22l1.5-4.5Z" />
  </svg>;
}

export function IconSparkle({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z" />
    <path d="M19 16l.5 1.5L21 18l-1.5.5L19 20l-.5-1.5L17 18l1.5-.5Z" />
  </svg>;
}

export function IconCalendar({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>;
}

export function IconCamera({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
    <circle cx="12" cy="13" r="4" />
  </svg>;
}

export function IconImage({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>;
}

export function IconLock({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>;
}

export function IconCheck({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="4 12 9 17 20 6" />
  </svg>;
}

export function IconPlus({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M12 5v14M5 12h14" />
  </svg>;
}

export function IconTrash({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>;
}

export function IconChevronLeft({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="15 6 9 12 15 18" />
  </svg>;
}

export function IconChevronRight({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="9 6 15 12 9 18" />
  </svg>;
}

export function IconCaretDown({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="6 9 12 15 18 9" />
  </svg>;
}

export function IconCaretRight({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="9 6 15 12 9 18" />
  </svg>;
}

export function IconFolder({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
  </svg>;
}

export function IconBook({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z" />
  </svg>;
}

export function IconFile({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>;
}

export function IconClipboard({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 13h6M9 17h6" />
  </svg>;
}

export function IconStar({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>;
}

export function IconStarEmpty({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" opacity={0.3}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>;
}

export function IconEye({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

export function IconRefresh({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M21.5 12A9.5 9.5 0 0 0 5.3 5.3L1 10" />
    <polyline points="23 20 23 14 17 14" />
    <path d="M2.5 12A9.5 9.5 0 0 0 18.7 18.7L23 14" />
  </svg>;
}

export function IconUpload({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>;
}

export function IconQuote({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1Z" />
    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1Z" />
  </svg>;
}

export function IconBrain({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M12 4a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V13a2 2 0 0 1-4 0v-1.5A4 4 0 0 1 12 4Z" />
    <path d="M6 12c-1.5.7-2.5 2-2.5 3.5A3.5 3.5 0 0 0 7 19c1 0 2-.4 2.7-1.1" />
    <path d="M18 12c1.5.7 2.5 2 2.5 3.5A3.5 3.5 0 0 1 17 19c-1 0-2-.4-2.7-1.1" />
    <path d="M12 22v-2" />
  </svg>;
}

export function IconTarget({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>;
}

export function IconX({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>;
}

export function IconSettings({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>;
}

export function IconList({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>;
}

export function IconSearch({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>;
}

export function IconArrowRight({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>;
}

export function IconFileText({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h8M8 17h5" />
  </svg>;
}

export function IconAlert({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M12 2L2 22h20L12 2Z" />
    <path d="M12 10v4M12 18h.01" />
  </svg>;
}

export function IconArrowLeft({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...S}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>;
}
