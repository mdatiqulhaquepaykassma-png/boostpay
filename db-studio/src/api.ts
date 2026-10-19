const TOKEN_KEY = 'boostpay_studio_token_v1';
const SESSION_KEY = 'boostpay_studio_session_v1';

export interface StudioSession {
  token: string;
  email: string;
  role: string;
}

export const StudioApi = {
  getSession(): StudioSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StudioSession) : null;
    } catch {
      return null;
    }
  },

  setSession(s: StudioSession | null): void {
    if (s) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      localStorage.setItem(TOKEN_KEY, s.token);
    } else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  async login(email: string, password: string): Promise<StudioSession> {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Login failed (${res.status})`);
    return { token: data.token, email: data.email || email, role: data.role || 'SUPERADMIN' };
  },

  async call(path: string, options: { method?: string; body?: any } = {}): Promise<any> {
    const sess = this.getSession();
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(sess ? { Authorization: `Bearer ${sess.token}` } : {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
};
