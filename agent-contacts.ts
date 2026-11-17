/** Public contact details voluntarily supplied by an agent. No account secrets. */
export type AgentContacts = { telegram: string; whatsapp: string; imo: string };
export function normalizeAgentContacts(value: unknown): { contacts?: AgentContacts; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Invalid contact details.' };
  const raw = value as Record<string, unknown>;
  if (['telegram', 'whatsapp', 'imo'].some(k => typeof raw[k] !== 'string')) return { error: 'All contact fields must be text.' };
  let telegram = (raw.telegram as string).trim();
  const whatsappRaw = (raw.whatsapp as string).trim();
  const imoRaw = (raw.imo as string).trim();
  if (telegram.length > 150 || whatsappRaw.length > 40 || imoRaw.length > 500) return { error: 'Contact detail is too long.' };
  if (telegram) {
    telegram = telegram.replace(/^@/, '');
    if (/^https?:\/\//i.test(telegram)) {
      try {
        const url = new URL(telegram);
        if (url.protocol !== 'https:' || !['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) return { error: 'Enter a Telegram username or a valid t.me profile link.' };
        telegram = url.pathname.replace(/^\/+|\/+$/g, '');
      } catch { return { error: 'Enter a Telegram username or a valid t.me profile link.' }; }
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegram)) return { error: 'Telegram username must contain 5–32 letters, digits or underscores and start with a letter.' };
  }
  let whatsapp = '';
  if (whatsappRaw) {
    if (!/^\+?[\d ()-]+$/.test(whatsappRaw)) return { error: 'WhatsApp must be a phone number with country code.' };
    whatsapp = whatsappRaw.replace(/[ ()-]/g, '').replace(/^\+/, '');
    if (!/^[1-9]\d{7,14}$/.test(whatsapp)) return { error: 'WhatsApp must include the country code and 8–15 digits.' };
  }
  let imo = '';
  if (imoRaw) {
    try {
      const u = new URL(imoRaw);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !(host === 'imo.im' || host.endsWith('.imo.im') || host === 'imoim.net' || host.endsWith('.imoim.net')) || u.pathname === '/') return { error: 'Paste your HTTPS imo profile link copied from the imo app.' };
      imo = u.toString();
    } catch { return { error: 'Paste your HTTPS imo profile link copied from the imo app.' }; }
  }
  return { contacts: { telegram, whatsapp, imo } };
}
export function publicAgentContacts(agent: any): AgentContacts {
  const raw = agent?.contacts;
  const normalized = normalizeAgentContacts({ telegram: raw?.telegram || '', whatsapp: raw?.whatsapp || '', imo: raw?.imo || '' });
  return normalized.contacts || { telegram: '', whatsapp: '', imo: '' };
}
