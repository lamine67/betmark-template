// Первый импорт каждого парсера (sync-*.ts, live-tracker-poll.ts)
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { bookcProxyCandidates } from "./parserProxy";

const proxyUrl = process.env.PARSER_PROXY_URL;
const g = globalThis as unknown as { __parserProxyInstalled?: boolean; fetch: typeof fetch };
if (proxyUrl && !g.__parserProxyInstalled) {
  g.__parserProxyInstalled = true;
  const noProxy = process.env.NO_PROXY || "localhost,127.0.0.1,::1";
  const agent = new EnvHttpProxyAgent({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy });
  // запросы к bookc.ru (проверка «ворот» и др.)
  const bbUrls = bookcProxyCandidates();
  const bbAgents = bbUrls.map((u) => new EnvHttpProxyAgent({ httpProxy: u, httpsProxy: u, noProxy }));
  let bbNext = bbAgents.length ? Math.floor(Math.random() * bbAgents.length) : 0;
  // Book R обрывает TLS с любого российского IP
  const bookrUrl = process.env.BOOKR_PROXY_URL;
  const bookrAgent = bookrUrl ? new EnvHttpProxyAgent({ httpProxy: bookrUrl, httpsProxy: bookrUrl, noProxy }) : null;
  const agentFor = (input: string | URL) => {
    if (!bbAgents.length && !bookrAgent) return agent;
    try {
      const h = new URL(String(input)).hostname;
      if (bookrAgent && (h === "bookr.com" || h.endsWith(".bookr.com"))) return bookrAgent;
      if (!bbAgents.length) return agent;
      return h === "bookc.ru" || h.endsWith(".bookc.ru") ? bbAgents[bbNext++ % bbAgents.length] : agent;
    } catch {
      return agent;
    }
  };
  const original = g.fetch;
  // Прокси на пике нагрузки иногда отвечает 503 на CONNECT («Proxy response (503) when HTTP Tunneling») или обрывает
  const PROXY_ERR = /Proxy response|HTTP Tunneling|ECONNRESET|socket hang up|UND_ERR_SOCKET|other side closed/i;
  const viaProxy = async (input: string | URL, init?: Record<string, unknown>): Promise<Response> => {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await undiciFetch(input as any, { ...(init as any), dispatcher: agentFor(input) })) as unknown as Response;
      } catch (e) {
        last = e;
        const cause = (e as { cause?: { message?: string; code?: string } })?.cause;
        const text = `${String(e)} ${cause?.message ?? ""} ${cause?.code ?? ""}`;
        const signal = init?.signal as AbortSignal | undefined;
        if (!PROXY_ERR.test(text) || signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1) + Math.random() * 400));
      }
    }
    throw last;
  };
  g.fetch = ((input: unknown, init?: Record<string, unknown>) => {
    if (typeof input === "string" || input instanceof URL) return viaProxy(input, init);
    // Request-объект: в парсерах не используется; не ломаем, но и не пропускаем молча
    console.error("[parserProxy] fetch(Request) без прокси - не ожидается в парсерах");
    return (original as unknown as (i: unknown, o?: unknown) => Promise<Response>)(input, init);
  }) as typeof fetch;
}
