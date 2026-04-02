import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Send, Bot, User, AlertCircle, Paperclip, X, LogOut,
  ChevronDown, ChevronUp, CheckCircle2, Circle, AlertTriangle,
} from "lucide-react";
import { getToken, clearTokens, logoutApi } from "@/lib/auth";

interface AgentEvent {
  type: string;
  content?: string;
  chunk?: string;
  message?: string;
  error?: string;
  plan?: any;
  step?: any;
  tool_name?: string;
  function_name?: string;
  function_args?: Record<string, any>;
  function_result?: string;
  tool_content?: any;
  thinking?: string;
  title?: string;
  vnc_url?: string;
  sandbox_id?: string;
  screenshot_b64?: string;
  results?: Array<{ title: string; url: string; snippet?: string }>;
  query?: string;
  status?: "calling" | "called" | "error";
  tool_call_id?: string;
  todo_items?: Array<{ text: string; completed: boolean }>;
  tasks?: Array<{ id: string; description: string; status: string }>;
  files?: Array<{ filename: string; download_url: string }>;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  error?: string;
  tools?: AgentEvent[];
  plan?: any;
  screenshot?: string;
}

interface PlanStep {
  id?: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  tools?: AgentEvent[];
}

interface Plan {
  title?: string;
  status?: string;
  steps: PlanStep[];
}

function getApiBase(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

// ---- Task Strip ----

function TaskStrip({ plan }: { plan: Plan }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const steps = plan.steps || [];
  const doneCount = steps.filter(s => s.status === "completed").length;

  const toggleStep = (i: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="border border-gray-700 rounded-xl mx-4 mb-2 bg-gray-900/80 backdrop-blur-sm overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/50 transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <span className="text-blue-400 text-xs font-semibold tracking-wide uppercase flex items-center gap-1">
          <Bot className="h-3 w-3" />
          {plan.title || "Plan"}
        </span>
        <span className="text-gray-500 text-xs">
          {doneCount}/{steps.length}
        </span>
        {plan.status === "running" && (
          <span className="flex items-center gap-1 ml-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          </span>
        )}
        {plan.status === "completed" && (
          <CheckCircle2 className="h-3 w-3 text-green-400 ml-1" />
        )}
        <span className="ml-auto text-gray-600">
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-0.5">
          {steps.map((step, i) => {
            const isRunning = step.status === "running";
            const isDone = step.status === "completed";
            const isFailed = step.status === "failed";
            const hasTool = (step.tools || []).length > 0;
            const isExpanded = expandedSteps.has(i);

            return (
              <div key={step.id || i}>
                <button
                  className="w-full flex items-center gap-2 py-1.5 text-left group"
                  onClick={() => hasTool && toggleStep(i)}
                >
                  <span className="flex-shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                    ) : isFailed ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    ) : isRunning ? (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-gray-600" />
                    )}
                  </span>
                  <span className={`text-xs flex-1 leading-tight ${
                    isDone ? "text-gray-500 line-through decoration-gray-600"
                    : isFailed ? "text-red-400"
                    : isRunning ? "text-gray-100 font-medium"
                    : "text-gray-500"
                  }`}>
                    {step.description}
                  </span>
                  {hasTool && (
                    <span className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </span>
                  )}
                </button>

                {isExpanded && hasTool && (
                  <div className="ml-5 mb-1 space-y-0.5">
                    {(step.tools || []).map((tool, j) => {
                      const fn = tool.function_name || tool.tool_name || "tool";
                      return (
                        <div key={tool.tool_call_id || j} className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-gray-800/50 rounded px-2 py-1">
                          <span className="text-blue-400 font-mono">{fn}</span>
                          {tool.status === "calling" && <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
                          {tool.status === "called" && <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
                          {tool.status === "error" && <AlertTriangle className="h-2.5 w-2.5 text-red-400" />}
                          {tool.function_args && (
                            <span className="truncate text-gray-600 max-w-[180px]">
                              {Object.values(tool.function_args)[0]?.toString().slice(0, 40)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [mode, setMode] = useState<"chat" | "agent">("agent");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  // Map sessionId -> sandboxId for correct file uploads
  const sandboxIdMapRef = useRef<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    setPlan(null);

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMsg: Message = {
      id: `asst-${Date.now()}`,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    const controller = new AbortController();
    cancelRef.current = () => controller.abort();

    const currentSessionId = sessionId;

    try {
      const token = getToken();
      const resp = await fetch(`${getApiBase()}/api/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          session_id: currentSessionId,
          mode,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status === 401) {
          clearTokens();
          window.location.reload();
          return;
        }
        const errData = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buf = "";

      const updateAssistant = (updater: (msg: Message) => Message) => {
        setMessages(prev => prev.map(m => m.id === assistantMsg.id ? updater(m) : m));
      };

      let streamContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event: AgentEvent = JSON.parse(jsonStr);

            if (event.type === "message_start") {
              streamContent = "";
            } else if (event.type === "message_chunk") {
              streamContent += event.chunk || "";
              updateAssistant(m => ({ ...m, content: streamContent }));
            } else if (event.type === "message_end") {
              updateAssistant(m => ({ ...m, isStreaming: false }));
            } else if (event.type === "message_correct" && event.content) {
              updateAssistant(m => ({ ...m, content: event.content || m.content, isStreaming: false }));
            } else if (event.type === "plan" && event.plan) {
              setPlan(event.plan);
              updateAssistant(m => ({ ...m, plan: event.plan }));
            } else if (event.type === "tool") {
              updateAssistant(m => ({
                ...m,
                tools: [...(m.tools || []), event],
              }));
              // Also push tool into the current plan step if running
              setPlan(prev => {
                if (!prev) return prev;
                const steps = prev.steps.map(s => {
                  if (s.status === "running") {
                    return { ...s, tools: [...(s.tools || []), event] };
                  }
                  return s;
                });
                return { ...prev, steps };
              });
            } else if (event.type === "sandbox_id" && event.sandbox_id) {
              sandboxIdMapRef.current[currentSessionId] = event.sandbox_id;
            } else if (event.type === "browser_screenshot" && event.screenshot_b64) {
              setScreenshot(event.screenshot_b64);
            } else if (event.type === "desktop_screenshot" && event.screenshot_b64) {
              setScreenshot(event.screenshot_b64);
            } else if (event.type === "error") {
              updateAssistant(m => ({
                ...m,
                error: event.error || "An error occurred",
                isStreaming: false,
              }));
            } else if (event.type === "done") {
              updateAssistant(m => ({ ...m, isStreaming: false }));
            }
          } catch {
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, error: err.message, isStreaming: false }
            : m
        ));
      }
    } finally {
      setIsLoading(false);
      cancelRef.current = null;
    }
  }, [input, isLoading, sessionId, mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleFileUpload = useCallback(async (file: File) => {
    const sandboxId = sandboxIdMapRef.current[sessionId];
    if (!sandboxId) {
      alert("No active sandbox session. Send a message first to start a session.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const token = getToken();
    try {
      const resp = await fetch(`${getApiBase()}/api/e2b/sessions/${sandboxId}/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      const data = await resp.json();
      const uploadedPath = data.path || file.name;
      setInput(prev => (prev ? `${prev} [File uploaded: ${uploadedPath}]` : `[File uploaded: ${uploadedPath}] `));
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    }
  }, [sessionId]);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-400" />
            <span className="font-semibold text-white">Dzeck AI</span>
            <Badge variant="outline" className="text-xs border-gray-600 text-gray-400">
              {mode === "agent" ? "Agent" : "Chat"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={mode === "chat" ? "text-blue-400" : "text-gray-400"}
              onClick={() => setMode("chat")}
            >
              Chat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={mode === "agent" ? "text-blue-400" : "text-gray-400"}
              onClick={() => setMode("agent")}
            >
              Agent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-red-400"
              title="Logout"
              onClick={async () => {
                const token = getToken();
                await logoutApi(token);
                clearTokens();
                window.location.reload();
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-w-0">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                    <Bot className="h-12 w-12 mb-3 text-gray-600" />
                    <p className="text-lg font-medium">Dzeck AI</p>
                    <p className="text-sm mt-1">Kirim pesan untuk mulai percakapan</p>
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user" ? "bg-blue-600" : "bg-gray-700"
                    }`}>
                      {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`flex flex-col gap-2 max-w-[80%] ${msg.role === "user" ? "items-end" : ""}`}>
                      <Card className={`p-3 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white border-blue-500"
                          : "bg-gray-800 text-gray-100 border-gray-700"
                      }`}>
                        {msg.error ? (
                          <div className="flex items-center gap-2 text-red-400">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            <span>{msg.error}</span>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {msg.content || (msg.isStreaming ? (
                              <span className="inline-flex items-center gap-1 text-gray-400">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Berpikir...</span>
                              </span>
                            ) : "")}
                          </div>
                        )}
                      </Card>
                      {msg.tools && msg.tools.length > 0 && (
                        <div className="space-y-1 w-full">
                          {msg.tools.map((tool, i) => (
                            <ToolCard key={i} event={tool} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div ref={bottomRef} />
            </ScrollArea>

            {/* Task/Plan Strip — anchored above input */}
            {plan && plan.steps && plan.steps.length > 0 && (
              <TaskStrip plan={plan} />
            )}

            {/* Input area */}
            <div className="px-4 pt-2 pb-3 border-t border-gray-800">
              <div className="max-w-3xl mx-auto">
                {/* Text area — transparent, borderless */}
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ketik pesan..."
                  className="w-full bg-transparent border-none shadow-none resize-none text-gray-100 placeholder-gray-500 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[56px] max-h-40 px-0 py-2"
                  disabled={isLoading}
                  rows={2}
                />
                {/* Toolbar row below text area */}
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-500 hover:text-gray-300"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      title="Attach file to sandbox"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    {isLoading ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancelRef.current?.()}
                        className="h-8 w-8 text-red-400 hover:text-red-300"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={sendMessage}
                        disabled={!input.trim()}
                        size="icon"
                        className="h-8 w-8 bg-blue-600 hover:bg-blue-700"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {screenshot && (
            <div className="w-80 flex-shrink-0 border-l border-gray-800 bg-gray-900 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400">Browser Preview</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setScreenshot(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <img
                src={`data:image/jpeg;base64,${screenshot}`}
                alt="Browser screenshot"
                className="w-full rounded border border-gray-700"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ event }: { event: AgentEvent }) {
  const fn = event.function_name || event.tool_name || "tool";
  const isSearch = fn.includes("search");
  const isBrowser = fn.includes("browser") || fn.includes("navigate");
  const isShell = fn.includes("shell") || fn.includes("exec");

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs text-gray-400">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-blue-400 font-mono">{fn}</span>
        {event.status && (
          <Badge
            variant="outline"
            className={`text-[10px] ${
              event.status === "called" ? "border-green-700 text-green-400"
              : event.status === "error" ? "border-red-700 text-red-400"
              : "border-gray-600 text-gray-500"
            }`}
          >
            {event.status}
          </Badge>
        )}
      </div>
      {isSearch && event.tool_content?.results && (
        <div className="space-y-1 mt-1">
          {(event.tool_content.results as any[]).slice(0, 3).map((r: any, i: number) => (
            <div key={i} className="text-gray-500">
              <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate block">
                {r.title}
              </a>
              <p className="truncate">{r.snippet}</p>
            </div>
          ))}
        </div>
      )}
      {(isBrowser || isShell) && event.tool_content?.type === "shell" && (
        <pre className="mt-1 text-green-400 font-mono overflow-x-auto max-h-20 text-[10px]">
          {event.tool_content.console || event.function_result}
        </pre>
      )}
      {!isSearch && !isShell && event.function_result && (
        <p className="mt-1 truncate text-gray-500">{event.function_result.slice(0, 200)}</p>
      )}
    </div>
  );
}
