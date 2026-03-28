/**
 * E2B Desktop Sandbox Service
 *
 * Client-side service for managing E2B desktop sandbox sessions.
 * Handles session creation, health polling, VNC URL resolution,
 * screenshot capture, and command execution.
 * All authenticated endpoints include Authorization headers automatically.
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
   * Get the stored auth token for attaching to requests.
   */
  private getToken(): string {
    try {
      const { getMemoryAccessToken } = require("./auth-service");
      const memToken = getMemoryAccessToken();
      if (memToken) return memToken;
    } catch {}
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return localStorage.getItem("dzeck_access_token") || "";
      }
    } catch {}
    return "";
  }

  /**
   * Build JSON headers with optional Authorization bearer token.
   */
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json", ...extra };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Build headers for non-JSON requests (e.g. file upload) with optional Authorization.
   */
  private authHeadersNoContentType(): Record<string, string> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Create a new E2B desktop sandbox session.
   */
  async createSession(options: CreateSessionOptions = {}): Promise<E2BSession> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions`, {
      method: "POST",
      headers: this.authHeaders(),
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
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Get info about a specific session.
   */
  async getSession(sessionId: string): Promise<E2BSession> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Check if a session's desktop is ready.
   */
  async checkHealth(sessionId: string): Promise<E2BHealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/health`, {
      headers: this.authHeaders(),
    });
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
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/vnc-url`, {
      headers: this.authHeaders(),
    });
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
      headers: this.authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  /**
   * Capture a screenshot from the session.
   * Returns the image as a base64 data URI.
   */
  async captureScreenshot(sessionId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/screenshot`, {
      headers: this.authHeadersNoContentType(),
    });
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
      headers: this.authHeaders(),
      body: JSON.stringify({ command, timeout }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Click at coordinates in a session.
   */
  async click(sessionId: string, x: number, y: number, button: string = "left", double: boolean = false): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/click`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ x, y, button, double }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Scroll in a session.
   */
  async scroll(sessionId: string, x: number, y: number, direction: string = "down", amount: number = 3): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/scroll`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ x, y, direction, amount }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Type text in a session.
   */
  async type(sessionId: string, text: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/type`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Press a key in a session.
   */
  async press(sessionId: string, key: string | string[]): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/press`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ key }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Move the mouse to coordinates in a session.
   */
  async moveMouse(sessionId: string, x: number, y: number): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/move-mouse`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ x, y }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Drag from one position to another in a session.
   */
  async drag(sessionId: string, fromX: number, fromY: number, toX: number, toY: number): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/drag`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ fromX, fromY, toX, toY }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Get the current cursor position in a session.
   */
  async getCursorPosition(sessionId: string): Promise<{ x: number; y: number }> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/cursor`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Get the screen size of a session.
   */
  async getScreenSize(sessionId: string): Promise<{ width: number; height: number }> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/screen-size`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Upload a file to the sandbox.
   */
  async uploadFile(sessionId: string, file: File): Promise<{ success: boolean; path: string; filename: string; size: number }> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/${sessionId}/upload`, {
      method: "POST",
      headers: this.authHeadersNoContentType(),
      body: formData,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Connect to an existing sandbox by sandbox ID.
   */
  async connectToSession(sandboxId: string, vncUrl?: string, resolution?: { width: number; height: number }): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/connect`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ sandbox_id: sandboxId, vnc_url: vncUrl, resolution }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Get the most recently active running session.
   */
  async getActiveSession(): Promise<{ found: boolean; session_id?: string; sandbox_id?: string; status?: string; vnc_url?: string; stream_url?: string; resolution?: { width: number; height: number } }> {
    const response = await fetch(`${this.baseUrl}/api/e2b/sessions/active`, {
      headers: this.authHeaders(),
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
