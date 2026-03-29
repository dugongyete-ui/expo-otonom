/**
 * MarkdownText — shared lightweight markdown renderer for React Native.
 * Handles: headings (H1–H3), bullet lists, numbered lists, horizontal rules,
 * blockquotes, code fences (delegated to CodeBlock), bold, italic, inline code.
 *
 * Used by ChatMessage.tsx and FilePanel.tsx so both render markdown identically.
 */
import React, { useMemo } from "react";
import { Text, View, StyleSheet } from "react-native";
import { CodeBlock } from "@/components/CodeBlock";

interface MarkdownTextProps {
  text: string;
  color?: string;
  fontSize?: number;
}

function renderInline(
  text: string,
  color: string,
  baseSize: number,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\*(.+?)\*)/g;
  let lastIdx = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(
        <Text key={`p-${key++}`} style={{ color, fontSize: baseSize }}>
          {text.slice(lastIdx, match.index)}
        </Text>,
      );
    }
    if (match[2]) {
      nodes.push(
        <Text
          key={`b-${key++}`}
          style={{ fontFamily: "Inter_700Bold", color, fontSize: baseSize }}
        >
          {match[2]}
        </Text>,
      );
    } else if (match[4]) {
      nodes.push(
        <Text
          key={`ic-${key++}`}
          style={[styles.inlineCode, { fontSize: baseSize - 1 }]}
        >
          {` ${match[4]} `}
        </Text>,
      );
    } else if (match[6]) {
      nodes.push(
        <Text
          key={`i-${key++}`}
          style={{ fontStyle: "italic", color, fontSize: baseSize }}
        >
          {match[6]}
        </Text>,
      );
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    nodes.push(
      <Text key={`e-${key}`} style={{ color, fontSize: baseSize }}>
        {text.slice(lastIdx)}
      </Text>,
    );
  }
  return nodes;
}

export function MarkdownText({
  text,
  color = "#1a1916",
  fontSize = 15,
}: MarkdownTextProps) {
  const blocks = useMemo(() => {
    const result: React.ReactNode[] = [];
    const lines = text.split("\n");
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx];

      // Fenced code block
      const fenceMatch = line.match(/^```(\w*)/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || "code";
        const codeLines: string[] = [];
        idx++;
        while (idx < lines.length && !lines[idx].startsWith("```")) {
          codeLines.push(lines[idx]);
          idx++;
        }
        result.push(
          <View key={`fence-${idx}`} style={styles.codeBlock}>
            <CodeBlock code={codeLines.join("\n")} language={lang} />
          </View>,
        );
        idx++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|={3,}|\*{3,})$/.test(line.trim())) {
        result.push(<View key={`hr-${idx}`} style={styles.hr} />);
        idx++;
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const sizes = [fontSize + 7, fontSize + 4, fontSize + 2];
        const lineHeight = [fontSize + 7, fontSize + 4, fontSize + 2].map(
          (s) => s * 1.4,
        );
        result.push(
          <Text
            key={`h${level}-${idx}`}
            style={[
              styles.heading,
              {
                fontSize: sizes[level - 1],
                lineHeight: lineHeight[level - 1],
                color,
                marginTop: level === 1 ? 12 : 8,
              },
            ]}
            selectable
          >
            {renderInline(headingMatch[2], color, sizes[level - 1])}
          </Text>,
        );
        idx++;
        continue;
      }

      // Blockquote
      const bqMatch = line.match(/^>\s*(.*)/);
      if (bqMatch) {
        result.push(
          <View key={`bq-${idx}`} style={styles.blockquote}>
            <Text
              style={[styles.blockquoteText, { color, fontSize }]}
              selectable
            >
              {renderInline(bqMatch[1], color, fontSize)}
            </Text>
          </View>,
        );
        idx++;
        continue;
      }

      // Bullet list
      const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
      if (bulletMatch) {
        result.push(
          <Text key={`li-${idx}`} style={[styles.listItem, { color, fontSize }]} selectable>
            {"  \u2022  "}
            {renderInline(bulletMatch[1], color, fontSize)}
          </Text>,
        );
        idx++;
        continue;
      }

      // Numbered list
      const numMatch = line.match(/^[\s]*(\d+)\.\s+(.+)/);
      if (numMatch) {
        result.push(
          <Text key={`nli-${idx}`} style={[styles.listItem, { color, fontSize }]} selectable>
            {`  ${numMatch[1]}.  `}
            {renderInline(numMatch[2], color, fontSize)}
          </Text>,
        );
        idx++;
        continue;
      }

      // Empty line — spacer
      if (line.trim() === "") {
        result.push(<View key={`sp-${idx}`} style={styles.spacer} />);
        idx++;
        continue;
      }

      // Regular paragraph line
      result.push(
        <Text key={`t-${idx}`} style={[styles.body, { color, fontSize }]} selectable>
          {renderInline(line, color, fontSize)}
        </Text>,
      );
      idx++;
    }

    return result;
  }, [text, color, fontSize]);

  return <View style={styles.root}>{blocks}</View>;
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "column",
  },
  heading: {
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  body: {
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  listItem: {
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: "#c7c0b0",
    paddingLeft: 12,
    marginVertical: 4,
  },
  blockquoteText: {
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  hr: {
    height: 1,
    backgroundColor: "#ddd9d0",
    marginVertical: 8,
  },
  spacer: {
    height: 6,
  },
  codeBlock: {
    marginVertical: 6,
  },
  inlineCode: {
    fontFamily: "monospace",
    backgroundColor: "#f0ede7",
    color: "#4a4740",
    paddingHorizontal: 5,
    borderRadius: 4,
  },
});
