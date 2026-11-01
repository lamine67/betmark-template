import { PrismaClient } from "@prisma/client";

// шлюз Gemini отвечает медленно (до нескольких минут из-за очереди и 503 у Google), поэтому пачки поменьше
const BATCH_SIZE = 30;
const REQUEST_TIMEOUT_MS = 480_000; // с запасом умещается в контекст одним запросом, не разбивает клубы вроде "Manchester United" на части

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function translateBatch(names: string[]): Promise<string[]> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL || "gemini-flash-lite-latest";
  if (!apiKey || !baseUrl) throw new Error("AI_API_KEY/AI_BASE_URL (Gemini-шлюз) не заданы в .env - перевод имён Book G недоступен");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      enable_thinking: false,
      messages: [
        {
          role: "system",
          content:
            "Ты - эксперт по русскоязычным спортивным СМИ и букмекерским сайтам. " +
            "Тебе дают английские названия спортивных команд или имена игроков (футбол, " +
            "хоккей, теннис). Переведи/транслитерируй каждое в ту форму, в которой его " +
            "принято писать в русскоязычных спортивных новостях и у букмекеров (Book A, " +
            "Book B и т.п.) - например 'Liverpool' -> 'Ливерпуль', 'Real Madrid' -> " +
            "'Реал Мадрид', 'Bayern Munich' -> 'Бавария', 'Novak Djokovic' -> 'Новак Джокович'. " +
            "Если это малоизвестная команда/игрок без устоявшегося русского написания - " +
            "сделай обычную практическую транслитерацию. Верни ТОЛЬКО JSON-объект вида " +
            '{"translations": ["...", "...", ...]} - ровно столько строк, сколько дано на ' +
            "входе, СТРОГО в том же порядке, без пропусков и объединений.",
        },
        { role: "user", content: JSON.stringify(names) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Gemini не вернул content");

  let parsed: { translations?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Gemini вернул невалидный JSON: ${String(content).slice(0, 300)}`);
  }
  if (!Array.isArray(parsed.translations) || parsed.translations.length !== names.length) {
    throw new Error(
      `Gemini вернул ${Array.isArray(parsed.translations) ? parsed.translations.length : "не массив"}, ожидалось ${names.length}`
    );
  }
  return parsed.translations as string[];
}

// sourceSlug - на будущее, если появится ещё один англоязычный источник (сейчас всегда "bookg")
export async function translateTeamNames(
  prisma: PrismaClient,
  sourceSlug: string,
  names: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(names)];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const cached = await prisma.teamNameTranslation.findMany({
    where: { sourceSlug, originalName: { in: unique } },
  });
  for (const c of cached) result.set(c.originalName, c.translatedName);

  const missing = unique.filter((n) => !result.has(n));
  if (missing.length === 0) return result;

  for (const batch of chunk(missing, BATCH_SIZE)) {
    try {
      const translated = await translateBatch(batch);
      await prisma.teamNameTranslation.createMany({
        data: batch.map((originalName, i) => ({ sourceSlug, originalName, translatedName: translated[i] })),
        skipDuplicates: true,
      });
      batch.forEach((originalName, i) => result.set(originalName, translated[i]));
    } catch (e) {
      console.error(`[translateNames] батч из ${batch.length} имён не переведён: ${(e as Error).message}`);
      for (const n of batch) result.set(n, n);
    }
  }
  return result;
}
