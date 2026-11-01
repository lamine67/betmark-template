// ИИ-зрение для "калибровки парсинга" кнопка на /status)
import { readFileSync } from "fs";

const API_KEY = process.env.AI_API_KEY;
// только Gemini (общий шлюз из .env); модели Gemini понимают картинки, поэтому отдельная vision-модель не нужна
const BASE_URL = process.env.AI_BASE_URL || "";
const VISION_MODEL = process.env.CALIBRATION_VISION_MODEL || process.env.AI_MODEL || "gemini-flash-lite-latest";
const TIMEOUT_MS = 30000;

function photoToDataUri(photoPath: string): string {
  const buf = readFileSync(photoPath);
  const ext = (photoPath.split(".").pop() || "").toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function callVision(systemPrompt: string, photoPath: string): Promise<Record<string, unknown> | null> {
  if (!API_KEY) {
    console.error("[calibrationAi] AI_API_KEY не задан - распознавание фото недоступно");
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: photoToDataUri(photoPath) } }],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("пустой content в ответе");
    return JSON.parse(text);
  } catch (e) {
    console.error("[calibrationAi] ошибка распознавания фото:", (e as Error).message);
    return null;
  }
}

// Book B: страна+лига читаются со скриншота САЙДБАРА сайта
export async function extractBookbTarget(
  photoPath: string
): Promise<{ country: string; league: string } | null> {
  const result = await callVision(
    "Тебе дан скриншот страницы букмекерской конторы Book B (сайт bookb.ru) - либо сайдбар со списком стран/лиг, " +
      "либо открытая страница конкретной лиги (тогда страна/лига видны в заголовке/хлебных крошках). Найди на " +
      "изображении НАЗВАНИЕ СТРАНЫ и НАЗВАНИЕ ЛИГИ ТОЧНО так, как они написаны на скриншоте (не переводи, не " +
      "сокращай, не исправляй - это будет использовано для поиска ТОЧНО такого же текста на живом сайте). " +
      'Верни ТОЛЬКО JSON {"country": "...", "league": "..."} или {"country": null, "league": null}, если на ' +
      "скриншоте нет ни страны, ни лиги Book B (например это скриншот другого сайта или нечитаемое изображение).",
    photoPath
  );
  if (!result || !result.country || !result.league) return null;
  return { country: String(result.country), league: String(result.league) };
}

// Остальные 4 конторы (Book A/Book E/Book H/Book G): читаем лигу и команды
export async function extractLeagueAndTeams(
  photoPath: string
): Promise<{ leagueName: string | null; homeTeam: string | null; awayTeam: string | null }> {
  const result = await callVision(
    "Тебе дан скриншот страницы букмекерской конторы (линия ставок на спорт). Найди на изображении: название лиги/" +
      "турнира, название команды/игрока-хозяина и команды/игрока-гостя КОНКРЕТНОГО матча, на который указывает " +
      "пользователь (если матчей несколько - возьми самый крупный/выделенный/первый). Верни названия ТОЧНО как " +
      "написаны на скриншоте, не переводи и не исправляй. Верни ТОЛЬКО JSON " +
      '{"leagueName": "...", "homeTeam": "...", "awayTeam": "..."} - используй null для любого поля, которое не ' +
      "смог прочитать.",
    photoPath
  );
  if (!result) return { leagueName: null, homeTeam: null, awayTeam: null };
  return {
    leagueName: result.leagueName ? String(result.leagueName) : null,
    homeTeam: result.homeTeam ? String(result.homeTeam) : null,
    awayTeam: result.awayTeam ? String(result.awayTeam) : null,
  };
}
