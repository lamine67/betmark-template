// Демо-синхронизация конторы bookc: берёт матчи у lib/collectors/demo.ts
import { runFootballOrHockeySync } from "./lib/syncRunner";
import { collectDemoFootball } from "./lib/collectors/demo";

runFootballOrHockeySync({
  label: "bookc",
  bookmakerSlug: "bookc",
  sportSlug: "football",
  sportName: "Футбол",
  fetchMatches: () => collectDemoFootball("bookc"),
});
