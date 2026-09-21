import type { JSX } from "preact";

type Props = JSX.SVGAttributes<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: Props & { children: preact.ComponentChildren }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  home: (p: Props) => <Svg {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></Svg>,
  chart: (p: Props) => <Svg {...p}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></Svg>,
  list: (p: Props) => <Svg {...p}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></Svg>,
  bell: (p: Props) => <Svg {...p}><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 004 0" /></Svg>,
  layers: (p: Props) => <Svg {...p}><path d="M12 2l10 5-10 5L2 7z" /><path d="M2 12l10 5 10-5" /><path d="M2 17l10 5 10-5" /></Svg>,
  gear: (p: Props) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></Svg>,
  eye: (p: Props) => <Svg {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></Svg>,
  heart: (p: Props) => <Svg {...p}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" /></Svg>,
  repeat: (p: Props) => <Svg {...p}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></Svg>,
  reply: (p: Props) => <Svg {...p}><path d="M21 12a8 8 0 01-8 8H7l-4 3V12a8 8 0 018-8h2a8 8 0 018 8z" /></Svg>,
  bookmark: (p: Props) => <Svg {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></Svg>,
  copy: (p: Props) => <Svg {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></Svg>,
  share: (p: Props) => <Svg {...p}><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></Svg>,
  close: (p: Props) => <Svg {...p}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></Svg>,
  refresh: (p: Props) => <Svg {...p}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.5 9a9 9 0 0114.9-3.4L23 10" /><path d="M1 14l4.6 4.4A9 9 0 0020.5 15" /></Svg>,
  trash: (p: Props) => <Svg {...p}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></Svg>,
  plus: (p: Props) => <Svg {...p}><path d="M12 5v14" /><path d="M5 12h14" /></Svg>,
  back: (p: Props) => <Svg {...p}><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></Svg>,
  external: (p: Props) => <Svg {...p}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" /></Svg>,
  search: (p: Props) => <Svg {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></Svg>,
  user: (p: Props) => <Svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>,
  flame: (p: Props) => <Svg {...p}><path d="M12 22c4.4 0 7-2.8 7-6.5 0-3-1.7-5-3.5-7-.3 2-1.2 3-2.5 3.5.3-3-1-6-3.5-8C9.6 6.5 8 8 6.5 10.3 5.5 12 5 13.5 5 15.5 5 19.2 7.6 22 12 22z" /></Svg>,
  clock: (p: Props) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>,
  hash: (p: Props) => <Svg {...p}><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3L8 21" /><path d="M16 3l-2 18" /></Svg>,
  crosshair: (p: Props) => <Svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v4" /><path d="M12 18v4" /><path d="M2 12h4" /><path d="M18 12h4" /></Svg>,
  check: (p: Props) => <Svg {...p} stroke-width="2.4"><path d="M20 6L9 17l-5-5" /></Svg>,
  pencil: (p: Props) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></Svg>,
  logo: (p: Props) => <Svg {...p} stroke-width="2.4"><path d="M5 5l14 14" /><path d="M19 5L5 19" /></Svg>,
};

export type IconName = keyof typeof Icon;
