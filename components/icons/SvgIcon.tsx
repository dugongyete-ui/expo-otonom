/**
 * SVG-based icon component using react-native-svg.
 * Completely independent of font loading - works 100% reliably.
 * Use this for critical UI icons (header, toolbar, etc.)
 */
import React from "react";
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon, G } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const defaultStroke = 2;

// ── Navigation & UI ─────────────────────────────────────────────────────────

export function MenuIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="3" y1="7" x2="21" y2="7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="3" y1="17" x2="21" y2="17" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="5" y1="5" x2="19" y2="19" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="19" y1="5" x2="5" y2="19" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="6,9 12,15 18,9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronUpIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="18,15 12,9 6,15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function EllipsisIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5" cy="12" r="1.5" fill={color} />
      <Circle cx="12" cy="12" r="1.5" fill={color} />
      <Circle cx="19" cy="12" r="1.5" fill={color} />
    </Svg>
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────

export function ArrowUpIcon({ size = 24, color = "#FFFFFF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M5 12l7-7 7 7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function StopIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x="5" y="5" width="14" height="14" rx="2" fill={color} />
    </Svg>
  );
}

export function ShareIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="18" cy="5" r="3" stroke={color} strokeWidth={defaultStroke} />
      <Circle cx="6" cy="12" r="3" stroke={color} strokeWidth={defaultStroke} />
      <Circle cx="18" cy="19" r="3" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function LogOutIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="16,17 21,12 16,7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="21" y1="12" x2="9" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CopyIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CheckIcon({ size = 24, color = "#4ade80" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="20,6 9,17 4,12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 24, color = "#30D158" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="9,12 11,14 15,10" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AlertCircleIcon({ size = 24, color = "#FF453A" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="12" y1="8" x2="12" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill={color} />
    </Svg>
  );
}

export function CloseCircleIcon({ size = 24, color = "#FF453A" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="15" y1="9" x2="9" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="9" y1="9" x2="15" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

// ── Tools & Features ─────────────────────────────────────────────────────────

export function TerminalIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="20" height="16" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="7,9 11,12 7,15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="12" y1="15" x2="17" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function ImageOutlineIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Circle cx="8.5" cy="8.5" r="1.5" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="21,15 16,10 5,21" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function FlashIcon({ size = 24, color = "#d97706" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" fill={color} />
    </Svg>
  );
}

export function ChatbubbleIcon({ size = 24, color = "#4a7cf0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="9" cy="10" r="1" fill={color} />
      <Circle cx="12" cy="10" r="1" fill={color} />
      <Circle cx="15" cy="10" r="1" fill={color} />
    </Svg>
  );
}

export function GlobeIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="2" y1="12" x2="22" y2="12" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function SearchOutlineIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="8" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function DocumentIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="14,2 14,8 20,8" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="8" y1="13" x2="16" y2="13" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="8" y1="17" x2="14" y2="17" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function PuzzleIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20.5 14.5c.3-.3.5-.7.5-1.1 0-.9-.7-1.6-1.6-1.6-.2 0-.4 0-.6.1L17 10V7h-3l-1.8-1.8c.1-.2.1-.4.1-.6C12.3 3.7 11.6 3 10.7 3c-.4 0-.8.2-1.1.5L8 5H5v3l-1.5 1.6c-.3.3-.5.7-.5 1.1 0 .9.7 1.6 1.6 1.6.2 0 .4 0 .6-.1L7 14v3h3l1.8 1.8c-.1.2-.1.4-.1.6 0 .9.7 1.6 1.6 1.6.4 0 .8-.2 1.1-.5L16 19h3v-3l1.5-1.5z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LockIcon({ size = 24, color = "#34C759" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="11" width="14" height="11" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M8 11V7a4 4 0 018 0v4" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function HelpCircleIcon({ size = 24, color = "#FFFFFF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="12" cy="17" r="1" fill={color} />
    </Svg>
  );
}

export function SettingsIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function ServerIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="2" width="20" height="8" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Rect x="2" y="14" width="20" height="8" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="6" y1="6" x2="6.01" y2="6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1="6" y1="18" x2="6.01" y2="18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function SparklesIcon({ size = 24, color = "#FFFFFF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" fill={color} />
      <Path d="M5 5l.5 1.5 1.5.5-1.5.5L5 9l-.5-1.5L3 7l1.5-.5L5 5z" fill={color} />
      <Path d="M19 13l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z" fill={color} />
    </Svg>
  );
}

export function SyncIcon({ size = 24, color = "#636366" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M23 4v6h-6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M1 20v-6h6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MailIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="22,6 12,13 2,6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function ClockIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="12,6 12,12 16,14" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MicIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="2" width="6" height="12" rx="3" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M19 10a7 7 0 01-14 0" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="12" y1="19" x2="12" y2="22" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="9" y1="22" x2="15" y2="22" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function DesktopIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="3" width="20" height="14" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="8" y1="21" x2="16" y2="21" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="12" y1="17" x2="12" y2="21" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function ListIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="8" y1="6" x2="21" y2="6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="8" y1="12" x2="21" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="8" y1="18" x2="21" y2="18" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="4" cy="6" r="1.5" fill={color} />
      <Circle cx="4" cy="12" r="1.5" fill={color} />
      <Circle cx="4" cy="18" r="1.5" fill={color} />
    </Svg>
  );
}

export function FilmIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="2" width="20" height="20" rx="2.18" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="7" y1="2" x2="7" y2="22" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="17" y1="2" x2="17" y2="22" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="2" y1="12" x2="22" y2="12" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="2" y1="7" x2="7" y2="7" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="2" y1="17" x2="7" y2="17" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="17" y1="17" x2="22" y2="17" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="17" y1="7" x2="22" y2="7" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function EllipseOutlineIcon({ size = 24, color = "#555555" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function ListCircleIcon({ size = 24, color = "#0A84FF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="9" y1="9" x2="15" y2="9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="9" y1="12" x2="15" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="9" y1="15" x2="13" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function HelpIcon({ size = 24, color = "#FFFFFF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="12" cy="17" r="1" fill={color} />
    </Svg>
  );
}

export function CopyOutlineIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function LockClosedIcon({ size = 24, color = "#34C759" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="11" width="14" height="11" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M8 11V7a4 4 0 018 0v4" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function DocumentTextIcon({ size = 24, color = "#FFD60A" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="14,2 14,8 20,8" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="8" y1="13" x2="16" y2="13" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="8" y1="17" x2="14" y2="17" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CircleOutlineIcon({ size = 24, color = "#555555" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function ExtensionPuzzleIcon({ size = 24, color = "#64D2FF" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20.5 14.5c.3-.3.5-.7.5-1.1 0-.9-.7-1.6-1.6-1.6-.2 0-.4 0-.6.1L17 10V7h-3l-1.8-1.8c.1-.2.1-.4.1-.6C12.3 3.7 11.6 3 10.7 3c-.4 0-.8.2-1.1.5L8 5H5v3l-1.5 1.6c-.3.3-.5.7-.5 1.1 0 .9.7 1.6 1.6 1.6.2 0 .4 0 .6-.1L7 14v3h3l1.8 1.8c-.1.2-.1.4-.1.6 0 .9.7 1.6 1.6 1.6.4 0 .8-.2 1.1-.5L16 19h3v-3l1.5-1.5z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function HandIcon({ size = 24, color = "#535350" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 11V6a2 2 0 00-4 0M14 10V4a2 2 0 00-4 0v2M10 10.5V6a2 2 0 00-4 0v8" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M6 14a5 5 0 005 5h2a5 5 0 005-5v-1.4a2 2 0 00-2-2H8a2 2 0 00-2 2V14z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChatbubbleOutlineIcon({ size = 24, color = "#7c3aed" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function HardwareChipIcon({ size = 24, color = "#ffffff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="7" y="7" width="10" height="10" rx="1" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="9" y1="4" x2="9" y2="7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="12" y1="4" x2="12" y2="7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="15" y1="4" x2="15" y2="7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="9" y1="17" x2="9" y2="20" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="12" y1="17" x2="12" y2="20" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="15" y1="17" x2="15" y2="20" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="4" y1="9" x2="7" y2="9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="4" y1="12" x2="7" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="4" y1="15" x2="7" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="17" y1="9" x2="20" y2="9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="17" y1="12" x2="20" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="17" y1="15" x2="20" y2="15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}
