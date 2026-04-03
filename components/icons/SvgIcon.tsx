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

export function TrashIcon({ size = 24, color = "#b0b0b0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M8 6V4h8v2" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19 6l-1 14H6L5 6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

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

export function CheckIcon({ size = 24, color = "#888888" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="20,6 9,17 4,12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 24, color = "#888888" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Polyline points="9,12 11,14 15,10" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AlertCircleIcon({ size = 24, color = "#888888" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="12" y1="8" x2="12" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill={color} />
    </Svg>
  );
}

export function CloseCircleIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function FlashIcon({ size = 24, color = "#888888" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" fill={color} />
    </Svg>
  );
}

export function ChatbubbleIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function LockIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function ListCircleIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function LockClosedIcon({ size = 24, color = "#888888" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="11" width="14" height="11" rx="2" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M8 11V7a4 4 0 018 0v4" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function DocumentTextIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function ExtensionPuzzleIcon({ size = 24, color = "#888888" }: IconProps) {
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

export function ChatbubbleOutlineIcon({ size = 24, color = "#888888" }: IconProps) {
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

// ── Additional icons ──────────────────────────────────────────────────────────

export function EyeIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function CameraIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function EditIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function FolderIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ArrowDownIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M19 12l-7 7-7-7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronBackIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="15,18 9,12 15,6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronForwardIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="9,18 15,12 9,6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AddIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function AddCircleIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={defaultStroke} />
      <Line x1="12" y1="8" x2="12" y2="16" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="8" y1="12" x2="16" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function DownloadIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="7,10 12,15 17,10" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="12" y1="15" x2="12" y2="3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function CloudUploadIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="16,16 12,12 8,16" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="12" y1="12" x2="12" y2="21" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SwapIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="17,1 21,5 17,9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 11V9a4 4 0 014-4h14" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Polyline points="7,23 3,19 7,15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M21 13v2a4 4 0 01-4 4H3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function MoveIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="5,9 2,12 5,15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="9,5 12,2 15,5" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="15,19 12,22 9,19" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="19,9 22,12 19,15" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="2" y1="12" x2="22" y2="12" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Line x1="12" y1="2" x2="12" y2="22" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function ExpandIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PlayIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="5,3 19,12 5,21" fill={color} />
    </Svg>
  );
}

export function HourglassIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 3h14M5 21h14" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
      <Path d="M6 3l6 9-6 9M18 3l-6 9 6 9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CodeIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="16,18 22,12 16,6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="8,6 2,12 8,18" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PaperclipIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function VideocamIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="23,7 16,12 23,17 23,7" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="1" y="5" width="15" height="14" rx="2" stroke={color} strokeWidth={defaultStroke} />
    </Svg>
  );
}

export function SaveIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="17,21 17,13 7,13 7,21" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="7,3 7,8 15,8" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="15,3 21,3 21,9" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function BulbIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 01-1 1H9a1 1 0 01-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LocateIcon({ size = 24, color = "#a0a0a0" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={defaultStroke} />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" />
    </Svg>
  );
}

export function StarIcon({ size = 24, color = "#a0a0a0", filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"}>
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" stroke={color} strokeWidth={defaultStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── NativeIcon: Universal SVG drop-in for Ionicons ───────────────────────────
// Maps any Ionicons name to an SVG icon. Use instead of <Ionicons> on native.

interface NativeIconProps {
  name: string;
  size?: number;
  color?: string;
}

export function NativeIcon({ name, size = 24, color = "#a0a0a0" }: NativeIconProps) {
  const n = name.replace(/-outline$/, "").replace(/-sharp$/, "");
  const props = { size, color };

  switch (n) {
    case "terminal": return <TerminalIcon {...props} />;
    case "document-text": return <DocumentTextIcon {...props} />;
    case "document": return <DocumentIcon {...props} />;
    case "save": return <SaveIcon {...props} />;
    case "create": return <EditIcon {...props} />;
    case "pencil": return <EditIcon {...props} />;
    case "folder-open": return <FolderIcon {...props} />;
    case "folder": return <FolderIcon {...props} />;
    case "search": return <SearchOutlineIcon {...props} />;
    case "image": return <ImageOutlineIcon {...props} />;
    case "globe": return <GlobeIcon {...props} />;
    case "eye": return <EyeIcon {...props} />;
    case "hand-left": return <HandIcon {...props} />;
    case "finger-print": return <HandIcon {...props} />;
    case "arrow-up": return <ArrowUpIcon {...props} />;
    case "arrow-down": return <ArrowDownIcon {...props} />;
    case "code-slash": return <CodeIcon {...props} />;
    case "code": return <CodeIcon {...props} />;
    case "locate": return <LocateIcon {...props} />;
    case "keypad": return <TerminalIcon {...props} />;
    case "list": return <ListIcon {...props} />;
    case "refresh": return <SyncIcon {...props} />;
    case "sync": return <SyncIcon {...props} />;
    case "camera": return <CameraIcon {...props} />;
    case "browsers": return <GlobeIcon {...props} />;
    case "add-circle": return <AddCircleIcon {...props} />;
    case "add": return <AddIcon {...props} />;
    case "close-circle": return <CloseCircleIcon {...props} />;
    case "close": return <CloseIcon {...props} />;
    case "swap-horizontal": return <SwapIcon {...props} />;
    case "move": return <MoveIcon {...props} />;
    case "cloud-upload": return <CloudUploadIcon {...props} />;
    case "desktop": return <DesktopIcon {...props} />;
    case "extension-puzzle": return <ExtensionPuzzleIcon {...props} />;
    case "chatbubble-ellipses": return <ChatbubbleIcon {...props} />;
    case "chatbubble": return <ChatbubbleOutlineIcon {...props} />;
    case "checkmark-circle": return <CheckCircleIcon {...props} />;
    case "checkmark": return <CheckIcon {...props} />;
    case "list-circle": return <ListCircleIcon {...props} />;
    case "lock-closed": return <LockClosedIcon {...props} />;
    case "lock": return <LockIcon {...props} />;
    case "chevron-up": return <ChevronUpIcon {...props} />;
    case "chevron-down": return <ChevronDownIcon {...props} />;
    case "chevron-back": return <ChevronBackIcon {...props} />;
    case "chevron-forward": return <ChevronForwardIcon {...props} />;
    case "arrow-back": return <ChevronBackIcon {...props} />;
    case "attach": return <PaperclipIcon {...props} />;
    case "stop": return <StopIcon {...props} />;
    case "flash": return <FlashIcon {...props} />;
    case "expand": return <ExpandIcon {...props} />;
    case "exit": return <LogOutIcon {...props} />;
    case "log-out": return <LogOutIcon {...props} />;
    case "alert-circle": return <AlertCircleIcon {...props} />;
    case "play": return <PlayIcon {...props} />;
    case "time": return <ClockIcon {...props} />;
    case "hourglass": return <HourglassIcon {...props} />;
    case "help-circle": return <HelpCircleIcon {...props} />;
    case "help": return <HelpIcon {...props} />;
    case "download": return <DownloadIcon {...props} />;
    case "bulb": return <BulbIcon {...props} />;
    case "videocam": return <VideocamIcon {...props} />;
    case "film": return <FilmIcon {...props} />;
    case "mail": return <MailIcon {...props} />;
    case "open": return <ExternalLinkIcon {...props} />;
    case "share": return <ShareIcon {...props} />;
    case "share-social": return <ShareIcon {...props} />;
    case "trash": return <TrashIcon {...props} />;
    case "copy": return <CopyIcon {...props} />;
    case "settings": return <SettingsIcon {...props} />;
    case "server": return <ServerIcon {...props} />;
    case "mic": return <MicIcon {...props} />;
    case "sparkles": return <SparklesIcon {...props} />;
    case "ellipsis-horizontal": return <EllipsisIcon {...props} />;
    case "ellipsis-vertical": return <EllipsisIcon {...props} />;
    case "menu": return <MenuIcon {...props} />;
    case "puzzle": return <PuzzleIcon {...props} />;
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={defaultStroke} />
        </Svg>
      );
  }
}
