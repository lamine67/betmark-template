// Демо-синхронизация конторы bookd: берёт матчи у lib/collectors/demo.ts
import { runFootballOrHockeySync } from "./lib/syncRunner";
import { collectDemoFootball } from "./lib/collectors/demo";

runFootballOrHockeySync({
  label: "bookd",
  bookmakerSlug: "bookd",
  sportSlug: "football",
  sportName: "Футбол",
  fetchMatches: () => collectDemoFootball("bookd"),
});
