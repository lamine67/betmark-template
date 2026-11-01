// Раздел «Вилки»
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "../../lib/session";
import { getPermsForUsername } from "../../lib/betmarkPerms";
import SiteHeader from "../../components/SiteHeader";
import ForksApp from "../../components/forks/ForksApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вилки | Betmark" };

export default async function ForksPage() {
  const cookieStore = await cookies();
  const session = await verifySessionCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) redirect("/login?next=/forks");
  const { hasAccess, perms } = await getPermsForUsername(session.username);
  const allowed = hasAccess && perms.forks_view;

  return (
    <>
      <header className="header">
        <SiteHeader />
      </header>
      <main className="main fk-page">
        <h1 className="sr-only">Сканер вилок</h1>
        {allowed ? (
          <ForksApp />
        ) : (
          <div className="auth-error">{hasAccess ? "У вашего аккаунта нет доступа к сканеру вилок." : "Доступ к Betmark для этого аккаунта отключён."}</div>
        )}
      </main>
    </>
  );
}
