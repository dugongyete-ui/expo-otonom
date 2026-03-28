import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage, ChatListItem } from "@/lib/chat";

const SESSIONS_KEY = "dzeck_chat_sessions";
const MAX_SESSIONS = 50;

export interface ChatSession {
  id: string;
  title: string;
  mode: "chat" | "agent";
  preview: string;
  timestamp: number;
  messages: ChatMessage[];
  agentEvents?: ChatListItem[];
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  try {
    const existing = await loadChatSessions();
    const filtered = existing.filter((s) => s.id !== session.id);
    const updated = [session, ...filtered].slice(0, MAX_SESSIONS);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail — history is non-critical
  }
}

export async function loadChatSessions(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

export async function deleteChatSession(id: string): Promise<void> {
  try {
    const existing = await loadChatSessions();
    const updated = existing.filter((s) => s.id !== id);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
  } catch {}
}

export async function clearAllSessions(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSIONS_KEY);
  } catch {}
}

export function buildSessionTitle(
  messages: ChatMessage[],
  agentEvents?: ChatListItem[],
): string {
  const userMsg = messages.find((m) => m.role === "user");
  if (userMsg?.content) {
    return userMsg.content.slice(0, 60) + (userMsg.content.length > 60 ? "…" : "");
  }
  if (agentEvents) {
    const userEvent = agentEvents.find(
      (e) => e.kind === "chat" && e.data.role === "user",
    );
    if (userEvent && "data" in userEvent) {
      const content = (userEvent as { kind: "chat"; data: ChatMessage }).data.content;
      return content.slice(0, 60) + (content.length > 60 ? "…" : "");
    }
  }
  return "New conversation";
}

export function buildSessionPreview(
  messages: ChatMessage[],
  agentEvents?: ChatListItem[],
): string {
  const assistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (assistant?.content) {
    return assistant.content.slice(0, 80) + (assistant.content.length > 80 ? "…" : "");
  }
  if (agentEvents) {
    for (let i = agentEvents.length - 1; i >= 0; i--) {
      const item = agentEvents[i];
      if (
        item.kind === "agent" &&
        item.data.type === "message" &&
        item.data.message
      ) {
        return (
          item.data.message.slice(0, 80) +
          (item.data.message.length > 80 ? "…" : "")
        );
      }
    }
  }
  return "";
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
