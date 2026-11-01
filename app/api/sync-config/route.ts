import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

const CONFIG_PATH = `${process.env.BETMARK_HOME || process.cwd()}/sync-config.json`;

const BOOKMAKER_SLUGS = ["booka", "bookb", "bookc", "bookd", "booke", "bookf", "bookg", "bookh", "booki", "bookj", "bookl"] as const;

// Разрешённые значения для селектов частоты - в секундах
const ALLOWED_INTERVALS = [0, 60, 300, 600, 1800, 3600];

const PREMATCH_INTERVALS = [0, 30, 60, 120, 300, 600, 900, 1800, 3600];
const CRYPTO_PREMATCH_INTERVALS = [300, 600, 900, 1800, 3600];
const LIVE_INTERVALS = [0, 5, 10, 15, 30, 60, 120];
const CRYPTO_SLUGS = ["bookm", "booko", "bookp", "books", "booku", "bookt", "bookr", "bookq", "bookn"];
const REPORT_SLUGS: string[] = ["booka", "booke", "bookd", "bookb", "bookf", "bookc", "bookg", "bookh", "booki", "bookj", "bookk", "bookm", "booko", "bookp", "books", "bookr", "booku", "bookt"];
const LIVE_SLUGS = ["booke", "bookd", "bookb", "bookf", "bookc", "bookg", "bookh", "booki", "bookj", "bookk", "bookm", "booko", "bookp", "books", "bookr", "booku", "bookt"];

function intervalMap(raw: unknown, allowed: (slug: string) => number[] | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [slug, v] of Object.entries(raw as Record<string, unknown>)) {
    const ok = allowed(slug);
    if (ok && typeof v === "number" && ok.includes(v)) out[slug] = v;
  }
  return out;
}
const prematchAllowed = (slug: string) => ((BOOKMAKER_SLUGS as readonly string[]).includes(slug) ? PREMATCH_INTERVALS : CRYPTO_SLUGS.includes(slug) ? CRYPTO_PREMATCH_INTERVALS : null);
const liveAllowed = (slug: string) => (LIVE_SLUGS.includes(slug) ? LIVE_INTERVALS : null);

const prisma = new PrismaClient();

interface SyncConfig {
  sports: { football: boolean; tennis: boolean; hockey: boolean };
  fullScan: boolean;
  bookmakers: Record<string, boolean>;
  aiChecks: boolean;
  fastIntervalSec: number;
  fullIntervalSec: number;
  defaultHiddenBookmakers: string[];
  prematchIntervals: Record<string, number>;
  liveIntervals: Record<string, number>;
  cryptoDisabled: string[];
  // Какие конторы показывать в PDF-отчётах лайва (/status -> Отчёты); пусто = все
  reportBooks: string[];
}

const DEFAULT_CONFIG: SyncConfig = {
  sports: { football: true, tennis: true, hockey: true },
  fullScan: true,
  bookmakers: Object.fromEntries(BOOKMAKER_SLUGS.map((s) => [s, true])),
  aiChecks: true,
  fastIntervalSec: 0,
  fullIntervalSec: 0,
  defaultHiddenBookmakers: [],
  prematchIntervals: {},
  liveIntervals: {},
  cryptoDisabled: [],
  reportBooks: [],
};

function readRaw(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readConfig(): SyncConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    // Мержим с дефолтом на случай если файл создан вручную/частично - отсутствующие поля не должны падать в UI как undefined
    return {
      sports: { ...DEFAULT_CONFIG.sports, ...parsed.sports },
      fullScan: parsed.fullScan ?? DEFAULT_CONFIG.fullScan,
      bookmakers: { ...DEFAULT_CONFIG.bookmakers, ...parsed.bookmakers },
      aiChecks: parsed.aiChecks ?? DEFAULT_CONFIG.aiChecks,
      fastIntervalSec: parsed.fastIntervalSec ?? DEFAULT_CONFIG.fastIntervalSec,
      fullIntervalSec: parsed.fullIntervalSec ?? DEFAULT_CONFIG.fullIntervalSec,
      defaultHiddenBookmakers: Array.isArray(parsed.defaultHiddenBookmakers)
        ? parsed.defaultHiddenBookmakers.filter((s: unknown) => typeof s === "string")
        : DEFAULT_CONFIG.defaultHiddenBookmakers,
      prematchIntervals: intervalMap(parsed.prematchIntervals, prematchAllowed),
      liveIntervals: intervalMap(parsed.liveIntervals, liveAllowed),
      reportBooks: Array.isArray(parsed.reportBooks) ? parsed.reportBooks.filter((s: unknown): s is string => typeof s === "string" && REPORT_SLUGS.includes(s)) : [],
      cryptoDisabled: Array.isArray(parsed.cryptoDisabled) ? parsed.cryptoDisabled.filter((s: unknown): s is string => typeof s === "string" && CRYPTO_SLUGS.includes(s)) : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "sync_view_config");
  if (!auth.ok) return auth.response;
  return NextResponse.json(readConfig());
}

// Валидация входа перед записью - эндпоинт публично доступен как и весь сайт
export async function PATCH(request: NextRequest) {
  const auth = await requirePerm(request, "sync_edit_config");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const current = readConfig();
  const next: SyncConfig = { ...current };

  if (body.sports && typeof body.sports === "object") {
    if (typeof body.sports.football === "boolean") next.sports.football = body.sports.football;
    if (typeof body.sports.tennis === "boolean") next.sports.tennis = body.sports.tennis;
    if (typeof body.sports.hockey === "boolean") next.sports.hockey = body.sports.hockey;
  }
  if (typeof body.fullScan === "boolean") next.fullScan = body.fullScan;
  if (typeof body.aiChecks === "boolean") next.aiChecks = body.aiChecks;
  if (body.bookmakers && typeof body.bookmakers === "object") {
    for (const slug of BOOKMAKER_SLUGS) {
      if (typeof body.bookmakers[slug] === "boolean") next.bookmakers[slug] = body.bookmakers[slug];
    }
  }
  if (typeof body.fastIntervalSec === "number" && ALLOWED_INTERVALS.includes(body.fastIntervalSec)) {
    next.fastIntervalSec = body.fastIntervalSec;
  }
  if (typeof body.fullIntervalSec === "number" && ALLOWED_INTERVALS.includes(body.fullIntervalSec)) {
    next.fullIntervalSec = body.fullIntervalSec;
  }
  if (Array.isArray(body.defaultHiddenBookmakers)) {
    next.defaultHiddenBookmakers = body.defaultHiddenBookmakers.filter(
      (s: unknown): s is string => typeof s === "string" && (BOOKMAKER_SLUGS as readonly string[]).includes(s)
    );
  }

  // интервалы приходят целым набором (так их отправляет панель): нет ключа у конторы = её значение по умолчанию
  if (body.prematchIntervals && typeof body.prematchIntervals === "object") next.prematchIntervals = intervalMap(body.prematchIntervals, prematchAllowed);
  if (body.liveIntervals && typeof body.liveIntervals === "object") next.liveIntervals = intervalMap(body.liveIntervals, liveAllowed);

  if (Array.isArray(body.reportBooks)) next.reportBooks = body.reportBooks.filter((s: unknown): s is string => typeof s === "string" && REPORT_SLUGS.includes(s));
  if (Array.isArray(body.cryptoDisabled)) {
    const before = new Set(current.cryptoDisabled);
    next.cryptoDisabled = body.cryptoDisabled.filter((s: unknown): s is string => typeof s === "string" && CRYPTO_SLUGS.includes(s));
    const now = new Set(next.cryptoDisabled);
    const off = [...now].filter((s) => !before.has(s));
    const on = [...before].filter((s) => !now.has(s));
    if (off.length) await prisma.bookmaker.updateMany({ where: { slug: { in: off } }, data: { active: false } });
    if (on.length) await prisma.bookmaker.updateMany({ where: { slug: { in: on } }, data: { active: true } });
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readRaw(), ...next }, null, 2));
  return NextResponse.json(next);
}
