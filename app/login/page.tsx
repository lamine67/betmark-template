import type { Metadata, Viewport } from "next";
import Logo from "../../components/Logo";

// Переопределяет themeColor из корневого layout.tsx (#1a73e8, подходит для светлого /board)
export const metadata: Metadata = { title: "Вход | Betmark" };

export const viewport: Viewport = {
  themeColor: "#06110c",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const next = params.next || "/board";

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob-1" aria-hidden="true" />
      <div className="auth-blob auth-blob-2" aria-hidden="true" />
      <div className="auth-blob auth-blob-3" aria-hidden="true" />
      <div className="auth-card" role="main">
        <Logo className="auth-logo-mark" variant="dark" />
        <h1 className="auth-subtitle">Вход по приглашению</h1>
        <form action="/api/auth/login" method="POST" className="auth-form">
          <input type="hidden" name="next" value={next} />
          <div className="auth-field">
            <input
              type="text"
              name="username"
              id="auth-username"
              className="auth-input"
              placeholder=" "
              autoComplete="username"
              required
              autoFocus
            />
            <label htmlFor="auth-username" className="auth-floating-label">
              Логин
            </label>
          </div>
          <div className="auth-field">
            <input
              type="password"
              name="password"
              id="auth-password"
              className="auth-input"
              placeholder=" "
              autoComplete="current-password"
              required
            />
            <label htmlFor="auth-password" className="auth-floating-label">
              Пароль
            </label>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit">
            Войти
          </button>
        </form>
      </div>
      {/* Подстраховка для плавающих подписей тот же баг, что на panel */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
document.querySelectorAll('.auth-field input').forEach(function(el){
  function refresh(){ el.classList.toggle('has-value', el.value.length > 0); }
  refresh();
  el.addEventListener('input', refresh);
  el.addEventListener('change', refresh);
  el.addEventListener('animationstart', function(e){ if (e.animationName === 'auth-autofill-start') refresh(); });
  setTimeout(refresh, 300);
  setTimeout(refresh, 1000);
});
`,
        }}
      />
    </div>
  );
}
