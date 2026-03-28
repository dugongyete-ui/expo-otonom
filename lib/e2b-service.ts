/**
 * E2B Desktop Sandbox Service
 *
 * Client-side service for managing E2B desktop sandbox sessions.
 * Handles session creation, health polling, VNC URL resolution,
 * screenshot capture, and command execution.
 */

export interface E2BSession {
  session_id: string;
  sandbox_id: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  resolution: { width: number; height: number };
  created_at: number;
  last_activity: number;
  vnc_url: string | null;
  ws_proxy_url: string | null;
  timeout: number;
  connected_clients: number;
  error?: string;
}

export interface E2BHealthResponse {
  ready: boolean;
  status: string;
  vnc_url?: string;
  ws_proxy_url?: string;
  resolution?: { width: number; height: number };
  error?: string;
}

export interface E2BVncInfo {
  vnc_ws_url: string;
  vnc_http_url: string;
  resolution: { width: number; height: number };
  connection: {
    url: string;
    path: string;
    shared: boolean;
    credentials: { password: string };
  };
}

export interface E2BExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface CreateSessionOptions {
  resolution?: { width: number; height: number };
  timeout?: number;
  startUrl?: string;
}

class E2BService {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  }

  /**
   * Create a new E2B desktop sandbox session.
   */
  async createSession(options: CreateSessionOptions = {}): Promise<E2BSession> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * List all active E2B sessions.
   */
  async listSessions(): Promise<{ sessions: E2BSession[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Get info about a specific session.
   */
  async getSession(sessionId: string): Promise<E2BSession> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Check if a session's desktop is ready.
   */
  async checkHealth(sessionId: string): Promise<E2BHealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Poll until session is ready, with max retries.
   */
  async waitForReady(
    sessionId: string,
    maxRetries: number = 30,
    intervalMs: number = 2000,
    onProgress?: (attempt: number, maxRetries: number) => void,
  ): Promise<E2BHealthResponse | null> {
    for (let i = 0; i < maxRetries; i++) {
      onProgress?.(i + 1, maxRetries);
      try {
        const health = await this.checkHealth(sessionId);
        if (health.ready) return health;
        if (health.status === "error") return health;
      } catch {
        // Ignore transient errors during polling
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  /**
   * Get the VNC WebSocket URL for a session.
   */
  async getVncUrl(sessionId: string): Promise<E2BVncInfo> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/vnc-url`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Build the local WebSocket proxy URL for a session.
   * This routes through the server's WS proxy to the E2B sandbox.
   */
  getLocalWsProxyUrl(sessionId: string): string {
    const base = this.baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    const proto = base.startsWith("https") ? "wss:" : "ws:";
    const host = base.replace(/^https?:\/\//, "");
    return `${proto}//${host}/api/e2b/sessions/${sessionId}/ws`;
  }

  /**
   * Destroy (stop) a session.
   */
  async destroySession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  /**
   * Capture a screenshot from the session.
   * Returns the image as a base64 data URI.
   */
  async captureScreenshot(sessionId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/screenshot`);
    if (!response.ok) throw new Error("Screenshot failed");
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Execute a command inside the sandbox.
   */
  async executeCommand(sessionId: string, command: string, timeout?: number): Promise<E2BExecResult> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Build the E2B VNC viewer URL (HTML page served by the server).
   */
  getViewerUrl(sessionId: string, takeover: boolean = false): string {
    const base = this.baseUrl || "";
    const params = new URLSearchParams({ session: sessionId });
    if (takeover) params.set("takeover", "1");
    return `${base}/api/e2b/viewer?${params.toString()}`;
  }
}

export const e2bService = new E2BService();
