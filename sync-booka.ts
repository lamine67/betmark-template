// Демо-синхронизация конторы booka: берёт матчи у lib/collectors/demo.ts
import { runFootballOrHockeySync } from "./lib/syncRunner";
import { collectDemoFootball } from "./lib/collectors/demo";

runFootballOrHockeySync({
  label: "booka",
  bookmakerSlug: "booka",
  sportSlug: "football",
  sportName: "Футбол",
  fetchMatches: () => collectDemoFootball("booka"),
});
