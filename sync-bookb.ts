// Демо-синхронизация конторы bookb: берёт матчи у lib/collectors/demo.ts
import { runFootballOrHockeySync } from "./lib/syncRunner";
import { collectDemoFootball } from "./lib/collectors/demo";

runFootballOrHockeySync({
  label: "bookb",
  bookmakerSlug: "bookb",
  sportSlug: "football",
  sportName: "Футбол",
  fetchMatches: () => collectDemoFootball("bookb"),
});
