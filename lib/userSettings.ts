import type { PrismaClient } from "@prisma/client";
import { CRYPTO_BOOKMAKER_SLUGS } from "./cryptoBooks";

// Какие крипто-конторы аккаунт перенёс в обычный Betmark
export async function getUserCryptoOnMain(prisma: PrismaClient, username: string): Promise<Set<string>> {
  const row = await prisma.userSetting.findUnique({ where: { username } });
  return new Set((row?.cryptoOnMain ?? []).filter((slug) => CRYPTO_BOOKMAKER_SLUGS.has(slug)));
}
