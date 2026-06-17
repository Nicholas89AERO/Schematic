import { useTheme } from './ThemeContext';
import type { Theme } from './ThemeContext';

export type CanvasPalette = {
  sheetBg: string;
  sheetPaper: string;
  sheetBorder: string;
  sheetInner: string;
  gridDot: string;
  zoneLine: string;
  zoneText: string;
  titleBg: string;
  titleLine: string;
  titleLabel: string;
  titleValue: string;
  titleValuePrimary: string;
  titleDivider: string;
  titleApproval: string;
  symbolFill: string;
  symbolStroke: string;
  symbolText: string;
  symbolRef: string;
  mutedText: string;
  selectionStroke: string;
  accentStroke: string;
  emptyTitle: string;
  emptySubtitle: string;
  ghostFill: string;
  ghostStroke: string;
  ghostLabel: string;
  ghostMuted: string;
  trunkStroke: string;
  revStripBg: string;
  revStripLine: string;
  revStripText: string;
  watermark: string;
};

export const SIGNAL_COLORS: Record<string, string> = {
  power_dc: '#f0883e',
  power_ac: '#f85149',
  arinc429: '#58a6ff',
  arinc664: '#79c0ff',
  mil_std_1553: '#c9d1d9',
  discrete: '#8b949e',
  analog: '#3fb950',
  rs422: '#d2a8ff',
  can: '#ffa657',
  ground: '#3fb950',
  unknown: '#6e7681',
};

const DARK_CANVAS: CanvasPalette = {
  sheetBg: '#111827',
  sheetPaper: '#141e30',
  sheetBorder: '#2a3550',
  sheetInner: '#141e30',
  gridDot: '#1e2d42',
  zoneLine: '#263045',
  zoneText: '#3a4d64',
  titleBg: '#0d1520',
  titleLine: '#2a3550',
  titleLabel: '#2e3d52',
  titleValue: '#8096af',
  titleValuePrimary: '#c0cfe0',
  titleDivider: '#1a2436',
  titleApproval: '#6b7e96',
  symbolFill: '#161b22',
  symbolStroke: '#30363d',
  symbolText: '#c9d1d9',
  symbolRef: '#79c0ff',
  mutedText: '#6e7681',
  selectionStroke: '#ffffff',
  accentStroke: '#58a6ff',
  emptyTitle: '#2e3d52',
  emptySubtitle: '#263045',
  ghostFill: '#1c2a42',
  ghostStroke: '#334155',
  ghostLabel: '#cbd5e1',
  ghostMuted: '#94a3b8',
  trunkStroke: '#c9d1d9',
  revStripBg: '#0f1623',
  revStripLine: '#1e2d42',
  revStripText: '#263045',
  watermark: '#263045',
};

const LIGHT_CANVAS: CanvasPalette = {
  sheetBg: '#f6f8fa',
  sheetPaper: '#ffffff',
  sheetBorder: '#c8d0d8',
  sheetInner: '#ffffff',
  gridDot: '#d0d7de',
  zoneLine: '#d0d7de',
  zoneText: '#656d76',
  titleBg: '#f6f8fa',
  titleLine: '#d0d7de',
  titleLabel: '#57606a',
  titleValue: '#424a53',
  titleValuePrimary: '#24292f',
  titleDivider: '#d0d7de',
  titleApproval: '#656d76',
  symbolFill: '#ffffff',
  symbolStroke: '#d0d7de',
  symbolText: '#24292f',
  symbolRef: '#0969da',
  mutedText: '#656d76',
  selectionStroke: '#0969da',
  accentStroke: '#0969da',
  emptyTitle: '#57606a',
  emptySubtitle: '#8c959f',
  ghostFill: '#f6f8fa',
  ghostStroke: '#d0d7de',
  ghostLabel: '#24292f',
  ghostMuted: '#656d76',
  trunkStroke: '#424a53',
  revStripBg: '#f6f8fa',
  revStripLine: '#d0d7de',
  revStripText: '#656d76',
  watermark: '#8c959f',
};

const PALETTES: Record<Theme, CanvasPalette> = {
  dark: DARK_CANVAS,
  light: LIGHT_CANVAS,
};

export function getCanvasPalette(theme: Theme): CanvasPalette {
  return PALETTES[theme];
}

export function useCanvasPalette(): CanvasPalette {
  const { theme } = useTheme();
  return getCanvasPalette(theme);
}
