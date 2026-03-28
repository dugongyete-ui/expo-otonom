/**
 * Custom Tool Icons - SVG-based icons matching ai-manus style.
 * Uses inline SVG on web platform, Ionicons fallback on native.
 * Each icon renders inside a styled rounded-rectangle or circle container
 * with inner shadow effects matching the ai-manus design language.
 */
import React from "react";
import { View, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface IconProps {
  size?: number;
  color?: string;
}

// Web-only SVG wrapper component
function WebSvgIcon({ size, svgContent }: { size: number; svgContent: string }) {
  if (Platform.OS !== "web") return null;
  return (
    <div
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}

// Shell Icon - Terminal prompt in rounded rectangle
export function ShellIcon({ size = 21, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#f5f3ee" stroke="#B9B9B7" stroke-width="0.857"/>
      <path d="M5.25 7L7 9L5.25 11" stroke="${color || '#535350'}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8.625 11H12" stroke="${color || '#535350'}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="terminal-outline" size={size * 0.7} color={color || "#535350"} />;
}

// Browser Icon - Compass in circle
export function BrowserIcon({ size = 21, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="15" height="15" rx="7.5" fill="#f5f3ee" stroke="#B9B9B7" stroke-width="0.857"/>
      <path d="M7.52 7.76C7.56 7.65 7.65 7.56 7.76 7.52L11.2 6.29C11.52 6.17 11.83 6.48 11.71 6.8L10.48 10.24C10.44 10.35 10.35 10.44 10.24 10.48L6.8 11.71C6.48 11.83 6.17 11.52 6.29 11.2L7.52 7.76Z" stroke="${color || '#535350'}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="globe-outline" size={size * 0.7} color={color || "#535350"} />;
}

// Edit/File Icon - Pencil in rounded rectangle
export function EditIcon({ size = 21, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#f5f3ee" stroke="#B9B9B7" stroke-width="0.857"/>
      <path d="M9.24 5.71C9.63 5.32 10.27 5.32 10.66 5.71C11.05 6.1 11.05 6.73 10.66 7.12L7.12 10.66H5.71V9.24L9.24 5.71Z" stroke="${color || '#535350'}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 12H12" stroke="${color || '#535350'}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="document-text-outline" size={size * 0.7} color={color || "#535350"} />;
}

// Search Icon - Magnifying glass in rounded rectangle
export function SearchIcon({ size = 21, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#f0ede7" stroke="#5F5F5F" stroke-width="0.857"/>
      <circle cx="8.57" cy="8.63" r="3" stroke="#ACACAC" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10.82 10.88L12.32 12.38" stroke="#ACACAC" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="search-outline" size={size * 0.7} color={color || "#535350"} />;
}

// TakeOver Icon - Cursor with rays
export function TakeOverIcon({ size = 16, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.36 12.88L7.43 7.37C7.44 7.23 7.5 7.13 7.62 7.09C7.73 7.04 7.84 7.06 7.94 7.17L11.75 11.04C11.85 11.16 11.88 11.28 11.82 11.39C11.77 11.51 11.66 11.57 11.51 11.58L10.08 11.62L11.28 14.39C11.32 14.47 11.32 14.54 11.3 14.62C11.28 14.7 11.23 14.76 11.14 14.8L10.45 15.07C10.36 15.11 10.28 15.11 10.21 15.06C10.13 15.03 10.08 14.97 10.04 14.89L8.91 12.08L7.92 13.09C7.82 13.19 7.7 13.22 7.56 13.18C7.42 13.14 7.36 13.04 7.36 12.88ZM4.9 11.04C5.02 11.17 5.09 11.33 5.09 11.53C5.09 11.72 5.02 11.88 4.89 12.01L3.49 13.41C3.36 13.54 3.2 13.61 3 13.6C2.81 13.6 2.64 13.53 2.51 13.4C2.39 13.27 2.33 13.11 2.33 12.92C2.33 12.73 2.39 12.56 2.52 12.43L3.92 11.04C4.06 10.91 4.22 10.84 4.41 10.85C4.61 10.85 4.77 10.91 4.9 11.04ZM3.67 8.04C3.67 8.22 3.6 8.39 3.46 8.52C3.32 8.65 3.16 8.72 2.97 8.72H0.96C0.78 8.72 0.62 8.65 0.48 8.52C0.34 8.39 0.27 8.22 0.27 8.04C0.27 7.85 0.34 7.69 0.48 7.56C0.62 7.42 0.78 7.35 0.96 7.35H2.97C3.16 7.35 3.32 7.42 3.46 7.56C3.6 7.69 3.67 7.85 3.67 8.04ZM7.9 3.8C7.71 3.8 7.55 3.73 7.42 3.59C7.28 3.46 7.21 3.3 7.21 3.11V1.11C7.21 0.91 7.28 0.75 7.42 0.62C7.55 0.48 7.71 0.42 7.9 0.42C8.09 0.42 8.25 0.48 8.38 0.62C8.52 0.75 8.59 0.91 8.59 1.11V3.11C8.59 3.3 8.52 3.46 8.38 3.59C8.25 3.73 8.09 3.8 7.9 3.8Z" fill="${color || 'currentColor'}"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="hand-left-outline" size={size * 0.8} color={color || "#535350"} />;
}

// MCP Icon - Puzzle piece
export function McpIcon({ size = 21, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#f5f3ee" stroke="#B9B9B7" stroke-width="0.857"/>
      <path d="M12 9.5H11.25C11.25 9.09 10.91 8.75 10.5 8.75C10.09 8.75 9.75 9.09 9.75 9.5H9V7.5H9.75C9.75 7.09 10.09 6.75 10.5 6.75C10.91 6.75 11.25 7.09 11.25 7.5H12V5.5H6V11.5H12V9.5Z" stroke="${color || '#535350'}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="extension-puzzle-outline" size={size * 0.7} color={color || "#535350"} />;
}

// Loading/Spinning icon
export function SpinningIcon({ size = 16, color }: IconProps) {
  return <Ionicons name="sync-outline" size={size} color={color || "#636366"} />;
}

// Success icon
export function SuccessIcon({ size = 16, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="#30D158" fill-opacity="0.15"/>
      <circle cx="8" cy="8" r="6.5" stroke="#30D158" stroke-opacity="0.3"/>
      <path d="M5 8L7 10L11 6" stroke="#30D158" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="checkmark-circle" size={size} color={color || "#30D158"} />;
}

// Error icon
export function ErrorIcon({ size = 16, color }: IconProps) {
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="#FF453A" fill-opacity="0.15"/>
      <circle cx="8" cy="8" r="6.5" stroke="#FF453A" stroke-opacity="0.3"/>
      <path d="M6 6L10 10M10 6L6 10" stroke="#FF453A" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return <Ionicons name="close-circle" size={size} color={color || "#FF453A"} />;
}

export default {
  ShellIcon,
  BrowserIcon,
  EditIcon,
  SearchIcon,
  TakeOverIcon,
  McpIcon,
  SpinningIcon,
  SuccessIcon,
  ErrorIcon,
};
