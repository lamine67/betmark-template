// Прокси для парсеров Betmark конторы не должны видеть реальный IP сервера
import { existsSync, readFileSync } from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export function parserProxyUrl(): string | null {
  return process.env.PARSER_PROXY_URL || null;
}

// Book C ходит через ОТДЕЛЬНЫЙ прокси (BOOKC_PROXY_URL): основной прокси Book C не пускает
export function bookcProxyPool(): string[] {
  return (process.env.BOOKC_PROXY_POOL || "").split(",").map((x) => x.trim()).filter(Boolean);
}
// Пропуск Antibot привязан к IP
const BB_DIR = (process.env.BETMARK_HOME || process.cwd());
export function bookcStateFile(proxyUrl: string | null | undefined): string {
  if (!proxyUrl || proxyUrl === process.env.BOOKC_PROXY_URL) return `${BB_DIR}/.bookc-state.json`;
  try {
    return `${BB_DIR}/.bookc-state-${new URL(proxyUrl).host.replace(/[^a-z0-9]/gi, "_")}.json`;
  } catch {
    return `${BB_DIR}/.bookc-state.json`;
  }
}
export function bookcProxyKey(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
// onlyHealthy: убрать прокси, которые «ворота»
export function bookcProxyCandidates(onlyHealthy = true): string[] {
  const out: string[] = [];
  if (process.env.BOOKC_PROXY_URL) out.push(process.env.BOOKC_PROXY_URL);
  for (const u of bookcProxyPool()) if (existsSync(bookcStateFile(u))) out.push(u);
  if (!onlyHealthy) return out;
  try {
    const j = JSON.parse(readFileSync("/tmp/bookc-gate.json", "utf8"));
    if (Date.now() - Number(j.at) < 40 * 60 * 1000 && j.proxies) {
      const ok = out.filter((u) => j.proxies[bookcProxyKey(u)] !== true);
      if (ok.length) return ok;
    }
  } catch {
    /* нет файла ворот - берём все */
  }
  return out;
}
let bbPoolIdx = -1;
export function bookcProxyUrl(): string | null {
  const c = bookcProxyCandidates();
  if (c.length) {
    bbPoolIdx = bbPoolIdx < 0 ? Math.floor(Math.random() * c.length) : bbPoolIdx + 1;
    return c[bbPoolIdx % c.length];
  }
  return parserProxyUrl();
}

// Chromium (Playwright): явная опция proxy
export function chromiumProxy(url?: string | null): { proxy?: { server: string; username?: string; password?: string; bypass?: string } } {
  const raw = url === undefined ? parserProxyUrl() : url;
  if (!raw) return {};
  const u = new URL(raw);
  return {
    proxy: {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      bypass: "localhost,127.0.0.1,[::1],203.0.113.10/16,203.0.113.10/8",
    },
  };
}

// WebSocket (библиотека ws): параметр agent
export function wsProxyAgent(): HttpsProxyAgent<string> | undefined {
  const raw = parserProxyUrl();
  return raw ? new HttpsProxyAgent(raw) : undefined;
}

// fetch с явным прокси (для кода, который работает в процессе без NODE_USE_ENV_PROXY, например в Next-сайте)
let agent: ProxyAgent | null = null;
export function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
  const raw = parserProxyUrl();
  if (!raw) return fetch(url, init);
  agent ??= new ProxyAgent(raw);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return undiciFetch(url, { ...(init as any), dispatcher: agent }) as unknown as Promise<Response>;
}
