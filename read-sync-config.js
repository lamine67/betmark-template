// Дампит sync-config.json в виде bash-переменных для `eval "$(node read-sync-config.js)"` в планировщиках панель
const fs = require("fs");
const CONFIG_PATH = `${process.env.BETMARK_HOME || process.cwd()}/sync-config.json`;

let c = {};
try {
  c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
} catch {
  // файла нет или битый - все флаги остаются дефолтными (true/0) ниже
}

const g = (v, d) => (v === undefined || v === null ? d : v);
const BOOKMAKERS = ["booka", "bookb", "bookc", "bookd"];

const lines = [
  `FOOTBALL_ON=${g(c.sports && c.sports.football, true)}`,
  `TENNIS_ON=${g(c.sports && c.sports.tennis, true)}`,
  `HOCKEY_ON=${g(c.sports && c.sports.hockey, true)}`,
  `FULLSCAN_ON=${g(c.fullScan, true)}`,
  `AI_CHECKS_ON=${g(c.aiChecks, true)}`,
  `FAST_INTERVAL=${g(c.fastIntervalSec, 0)}`,
  `FULL_INTERVAL=${g(c.fullIntervalSec, 0)}`,
];
const sec = (v) => (Number.isInteger(v) && v >= 0 && v <= 86400 ? v : "");
const pi = c.prematchIntervals && typeof c.prematchIntervals === "object" ? c.prematchIntervals : {};
const CRYPTO = [];
for (const b of BOOKMAKERS) {
  lines.push(`BK_${b.toUpperCase()}_ON=${g(c.bookmakers && c.bookmakers[b], true)}`);
  lines.push(`BK_${b.toUpperCase()}_INT=${sec(pi[b])}`);
}
const cd = Array.isArray(c.cryptoDisabled) ? c.cryptoDisabled : [];
for (const b of CRYPTO) {
  lines.push(`CR_${b.toUpperCase()}_INT=${sec(pi[b])}`);
  lines.push(`CR_${b.toUpperCase()}_ON=${cd.includes(b) ? "false" : "true"}`);
}
console.log(lines.join("\n"));
