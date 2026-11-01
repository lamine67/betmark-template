import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "../../lib/session";
import { isCryptoHost } from "../../lib/cryptoBooks";
import { releasesForHost, formatReleaseDate } from "../../lib/whatsNew";
import SiteHeader from "../../components/SiteHeader";
import WhatsNewView from "../../components/WhatsNewView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Что нового | Betmark" };

// Страница «Что нового» журнал обновлений - слева версии по дням, справа выбранное обновление
export default async function WhatsNewPage() {
  const cookieStore = await cookies();
  const session = await verifySessionCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) redirect("/login?next=/whats-new");

  const releases = releasesForHost(isCryptoHost(await headers())).map((r) => ({
    version: r.version,
    title: r.title,
    dateLabel: formatReleaseDate(r.date),
    added: r.added.map(({ tag, text }) => ({ tag, text })),
    improved: r.improved.map(({ tag, text }) => ({ tag, text })),
  }));

  return (
    <>
      <header className="header">
        <SiteHeader />
      </header>
      <main className="main wn-main">
        <WhatsNewView releases={releases} />
      </main>
    </>
  );
}
