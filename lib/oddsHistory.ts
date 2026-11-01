// Общий хелпер записи истории коэффициентов - используется всеми sync-<slug>.ts
import { PrismaClient, MarketType } from "@prisma/client";

export async function recordOddsIfChanged(
  prisma: PrismaClient,
  bookmakerMatchId: string,
  market: MarketType,
  outcome: string,
  price: number
): Promise<void> {
  const latest = await prisma.oddsSnapshot.findFirst({
    where: { bookmakerMatchId, market, outcome },
    orderBy: { capturedAt: "desc" },
  });
  if (latest && latest.price === price) return;

  await prisma.oddsSnapshot.create({
    data: { market, outcome, price, bookmakerMatchId },
  });
}
