// Конторы прематч-отчётов (без серверных импортов - используется и окном выбора контор в браузере)
import { LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_DISPLAY } from "./liveAdapters";

// порядок колонок: как в live (обычные, затем крипто), конторы, которых нет в live, в конце
export const PREMATCH_BOOK_ORDER: string[] = [
  ...(LIVE_ADAPTER_SLUGS as readonly string[]),
  "bookl",
  ...(CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[]),
  "bookn",
  "bookq",
];

const DISPLAY: Record<string, string> = {
  booka: "Book A",
  bookb: "Book B",
  bookc: "Book C",
  booke: "Book E",
  bookf: "Book F",
  bookd: "Book D",
  bookg: "Book G",
  bookh: "Book H",
  booki: "Book I",
  bookj: "Book J",
  bookk: "Book K",
  bookl: "Book L",
  bookn: "Book N",
  bookq: "Book Q",
  ...CRYPTO_LIVE_ADAPTER_DISPLAY,
};
export const prematchBookName = (slug: string) => DISPLAY[slug] ?? slug;

