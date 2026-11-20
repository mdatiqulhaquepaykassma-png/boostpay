export type CommunityChannels = { telegram: string; whatsapp: string; imo: string };
const allowed: Record<keyof CommunityChannels, string[]> = {
  telegram: ['t.me', 'telegram.me'],
  whatsapp: ['whatsapp.com', 'wa.me'],
  imo: ['imo.im', 'imoim.net']
};
export function normalizeCommunityChannels(input: unknown): { channels?: CommunityChannels; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid channel links.' };
  const result: CommunityChannels = { telegram: '', whatsapp: '', imo: '' };
  for (const key of Object.keys(result) as Array<keyof CommunityChannels>) {
    const value = (input as any)[key];
    if (typeof value !== 'string' || value.length > 1000) return { error: `Invalid ${key} link.` };
    if (!value.trim()) continue;
    try {
      const url = new URL(value.trim());
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed[key].some(base => host === base || host.endsWith('.' + base)) || url.pathname === '/') return { error: `Enter an official HTTPS ${key} channel link.` };
      result[key] = url.href;
    } catch { return { error: `Enter an official HTTPS ${key} channel link.` }; }
  }
  return { channels: result };
}
export function storedCommunityChannels(value: unknown): CommunityChannels {
  const x = value && typeof value === 'object' ? value as any : {};
  return normalizeCommunityChannels({ telegram: typeof x.telegram === 'string' ? x.telegram : '', whatsapp: typeof x.whatsapp === 'string' ? x.whatsapp : '', imo: typeof x.imo === 'string' ? x.imo : '' }).channels || { telegram: '', whatsapp: '', imo: '' };
}
