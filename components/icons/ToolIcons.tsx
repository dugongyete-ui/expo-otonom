/**
 * Custom Tool Icons - SVG-based icons matching monochrome style.
 * Uses inline SVG on web platform, react-native-svg on native.
 */
import React, { useEffect, useRef } from "react";
import { View, Platform, StyleSheet, Animated, Easing } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
}

function WebSvgIcon({ size, svgContent }: { size: number; svgContent: string }) {
  if (Platform.OS !== "web") return null;
  return (
    <div
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}

export function ShellIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <path d="M5.25 7L7 9L5.25 11" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8.625 11H12" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Path d="M2 4.7C2 3.21 3.21 2 4.7 2H14.3C15.79 2 17 3.21 17 4.7V13.3C17 14.79 15.79 16 14.3 16H4.7C3.21 16 2 14.79 2 13.3V4.7Z" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Path d="M5.25 7L7 9L5.25 11" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8.625 11H12" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function BrowserIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="15" height="15" rx="7.5" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <path d="M7.52 7.76C7.56 7.65 7.65 7.56 7.76 7.52L11.2 6.29C11.52 6.17 11.83 6.48 11.71 6.8L10.48 10.24C10.44 10.35 10.35 10.44 10.24 10.48L6.8 11.71C6.48 11.83 6.17 11.52 6.29 11.2L7.52 7.76Z" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Circle cx="9" cy="9" r="7.5" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Path d="M7.52 7.76C7.56 7.65 7.65 7.56 7.76 7.52L11.2 6.29C11.52 6.17 11.83 6.48 11.71 6.8L10.48 10.24C10.44 10.35 10.35 10.44 10.24 10.48L6.8 11.71C6.48 11.83 6.17 11.52 6.29 11.2L7.52 7.76Z" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function EditIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <path d="M9.24 5.71C9.63 5.32 10.27 5.32 10.66 5.71C11.05 6.1 11.05 6.73 10.66 7.12L7.12 10.66H5.71V9.24L9.24 5.71Z" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 12H12" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Path d="M2 4.7C2 3.21 3.21 2 4.7 2H14.3C15.79 2 17 3.21 17 4.7V13.3C17 14.79 15.79 16 14.3 16H4.7C3.21 16 2 14.79 2 13.3V4.7Z" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Path d="M9.24 5.71C9.63 5.32 10.27 5.32 10.66 5.71C11.05 6.1 11.05 6.73 10.66 7.12L7.12 10.66H5.71V9.24L9.24 5.71Z" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 12H12" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SearchIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <circle cx="8.57" cy="8.63" r="3" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10.82 10.88L12.32 12.38" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Path d="M2 4.7C2 3.21 3.21 2 4.7 2H14.3C15.79 2 17 3.21 17 4.7V13.3C17 14.79 15.79 16 14.3 16H4.7C3.21 16 2 14.79 2 13.3V4.7Z" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Circle cx={8.57} cy={8.63} r={3} stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.82 10.88L12.32 12.38" stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TakeOverIcon({ size = 16, color }: IconProps) {
  const c = color || "#535350";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.36 12.88L7.43 7.37C7.44 7.23 7.5 7.13 7.62 7.09C7.73 7.04 7.84 7.06 7.94 7.17L11.75 11.04C11.85 11.16 11.88 11.28 11.82 11.39C11.77 11.51 11.66 11.57 11.51 11.58L10.08 11.62L11.28 14.39C11.32 14.47 11.32 14.54 11.3 14.62C11.28 14.7 11.23 14.76 11.14 14.8L10.45 15.07C10.36 15.11 10.28 15.11 10.21 15.06C10.13 15.03 10.08 14.97 10.04 14.89L8.91 12.08L7.92 13.09C7.82 13.19 7.7 13.22 7.56 13.18C7.42 13.14 7.36 13.04 7.36 12.88Z" fill="${c}"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M7.36 12.88L7.43 7.37C7.44 7.23 7.5 7.13 7.62 7.09C7.73 7.04 7.84 7.06 7.94 7.17L11.75 11.04C11.85 11.16 11.88 11.28 11.82 11.39C11.77 11.51 11.66 11.57 11.51 11.58L10.08 11.62L11.28 14.39C11.32 14.47 11.32 14.54 11.3 14.62C11.28 14.7 11.23 14.76 11.14 14.8L10.45 15.07C10.36 15.11 10.28 15.11 10.21 15.06C10.13 15.03 10.08 14.97 10.04 14.89L8.91 12.08L7.92 13.09C7.82 13.19 7.7 13.22 7.56 13.18C7.42 13.14 7.36 13.04 7.36 12.88Z" fill={c} />
    </Svg>
  );
}

export function MessageIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <path d="M5.5 6.5H13.5M5.5 9H10.5M5.5 11.5L4 14L7 12.5H13.5C14.05 12.5 14.5 12.05 14.5 11.5V6.5C14.5 5.95 14.05 5.5 13.5 5.5H5.5C4.95 5.5 4.5 5.95 4.5 6.5V11.5C4.5 12.05 4.95 12.5 5.5 12.5Z" stroke="${c}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Path d="M2 4.7C2 3.21 3.21 2 4.7 2H14.3C15.79 2 17 3.21 17 4.7V13.3C17 14.79 15.79 16 14.3 16H4.7C3.21 16 2 14.79 2 13.3V4.7Z" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Path d="M5.5 6.5H13.5M5.5 9H10.5M5.5 11.5L4 14L7 12.5H13.5C14.05 12.5 14.5 12.05 14.5 11.5V6.5C14.5 5.95 14.05 5.5 13.5 5.5H5.5C4.95 5.5 4.5 5.95 4.5 6.5V11.5C4.5 12.05 4.95 12.5 5.5 12.5Z" stroke={c} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function McpIcon({ size = 21, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="14" height="14" rx="2.7" fill="#1e1e1e" stroke="#2a2a2a" stroke-width="0.857"/>
      <path d="M12 9.5H11.25C11.25 9.09 10.91 8.75 10.5 8.75C10.09 8.75 9.75 9.09 9.75 9.5H9V7.5H9.75C9.75 7.09 10.09 6.75 10.5 6.75C10.91 6.75 11.25 7.09 11.25 7.5H12V5.5H6V11.5H12V9.5Z" stroke="${c}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 19 18" fill="none">
      <Path d="M2 4.7C2 3.21 3.21 2 4.7 2H14.3C15.79 2 17 3.21 17 4.7V13.3C17 14.79 15.79 16 14.3 16H4.7C3.21 16 2 14.79 2 13.3V4.7Z" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth={0.857} />
      <Path d="M12 9.5H11.25C11.25 9.09 10.91 8.75 10.5 8.75C10.09 8.75 9.75 9.09 9.75 9.5H9V7.5H9.75C9.75 7.09 10.09 6.75 10.5 6.75C10.91 6.75 11.25 7.09 11.25 7.5H12V5.5H6V11.5H12V9.5Z" stroke={c} strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SpinningIcon({ size = 16, color }: IconProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const c = color || "#888888";

  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="${c}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    return (
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <WebSvgIcon size={size} svgContent={svg} />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke={c} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

export function SuccessIcon({ size = 16, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.04)"/>
      <circle cx="8" cy="8" r="6.5" stroke="#3a3a3a"/>
      <path d="M5 8L7 10L11 6" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={7} fill="rgba(255,255,255,0.04)" />
      <Circle cx={8} cy={8} r={6.5} stroke="#3a3a3a" />
      <Path d="M5 8L7 10L11 6" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ErrorIcon({ size = 16, color }: IconProps) {
  const c = color || "#888888";
  if (Platform.OS === "web") {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.04)"/>
      <circle cx="8" cy="8" r="6.5" stroke="#3a3a3a"/>
      <path d="M6 6L10 10M10 6L6 10" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    return <WebSvgIcon size={size} svgContent={svg} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={7} fill="rgba(255,255,255,0.04)" />
      <Circle cx={8} cy={8} r={6.5} stroke="#3a3a3a" />
      <Path d="M6 6L10 10M10 6L6 10" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export default {
  ShellIcon,
  BrowserIcon,
  EditIcon,
  SearchIcon,
  TakeOverIcon,
  MessageIcon,
  McpIcon,
  SpinningIcon,
  SuccessIcon,
  ErrorIcon,
};
