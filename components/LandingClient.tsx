"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import dynamic from "next/dynamic";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

const FEATURES = [
  {
    icon: "grid_view",
    title: "Все букмекеры в едином интерфейсе",
    text: "Классические букмекеры — Book A, Book B, Book C, Book D, Book E, Book F, Book G, Book H, Book I, Book L, Book K и биржа Book J — на одном экране, без переключения вкладок.",
  },
  {
    icon: "currency_bitcoin",
    title: "Крипто-версия",
    text: "Отдельная платформа с крипто-букмекерами: Book M, Book O (обе линии), Book P и Book Q — те же матчи и единый удобный интерфейс.",
  },
  {
    icon: "bolt",
    title: "Регулярное автоматическое обновление",
    text: "Линии обновляются автоматически каждые несколько минут. Приоритет отдаётся ведущим турнирам — РПЛ, АПЛ, Серия A, Лига чемпионов, КХЛ, НХЛ, — остальные подгружаются следом.",
  },
  {
    icon: "balance",
    title: "Автоматический расчёт Payout %",
    text: "Система автоматически рассчитывает маржу по лучшим коэффициентам каждого матча и выделяет наиболее выгодные котировки — сразу видно, у какого букмекера предложение лучше.",
  },
  {
    icon: "timeline",
    title: "Единый Live-трекер",
    text: "Универсальный трекер для классических и крипто-букмекеров: динамика коэффициентов, счёта и голов от стартового до финального свистка, а также итоговый PDF-отчёт по матчу.",
  },
  {
    icon: "calculate",
    title: "Калькулятор вилок",
    text: "Рассчитывает оптимальное распределение ставок для выбранной комбинации коэффициентов — без ручных подсчётов и сторонних калькуляторов.",
  },
  {
    icon: "psychology",
    title: "Автоматический контроль данных",
    text: "Алгоритмы объединяют один и тот же матч с разными вариантами написания команд, отмечают нерыночные коэффициенты и контролируют полноту линий в ведущих турнирах.",
  },
  {
    icon: "history",
    title: "История коэффициентов",
    text: "Betmark фиксирует динамику линии: на странице матча доступна полная хронология изменения котировок по каждому букмекеру, а не только текущие значения.",
  },
  {
    icon: "monitoring",
    title: "Прозрачный статус",
    text: "Раздел «Статус» отображает точное время последнего обновления данных по каждому букмекеру — вы всегда уверены в актуальности котировок.",
  },
];

type Book = { name: string; slug: string; group: "ru" | "crypto"; note?: string; label?: string };
// Конторы в ленте и в блоке «Две версии». slug - ключ для публичной статистики (/api/public/bookmakers)
const BOOKS: Book[] = [
  { name: "Book A", slug: "booka", group: "ru" },
  { name: "Book B", slug: "bookb", group: "ru" },
  { name: "Book C", slug: "bookc", group: "ru" },
  { name: "Book D", slug: "bookd", group: "ru" },
  { name: "Book E", slug: "booke", group: "ru" },
  { name: "Book F", slug: "bookf", group: "ru" },
  { name: "Book G", slug: "bookg", group: "ru", label: "Международный букмекер" },
  { name: "bookh", slug: "bookh", group: "ru" },
  { name: "Book I", slug: "booki", group: "ru" },
  { name: "Book L", slug: "bookl", group: "ru" },
  { name: "Book K", slug: "bookk", group: "ru" },
  { name: "Book J", slug: "bookj", group: "ru", label: "Биржа ставок" },
  { name: "Book M", slug: "bookm", group: "crypto" },
  { name: "Book O", slug: "booko", group: "crypto", note: "Линия «Провайдер Alpha» у Book O — вторая линия букмекера (Beta) сканируется отдельно." },
  { name: "Book N", slug: "bookn", group: "crypto", note: "Линия «Провайдер Beta» у Book O — первая линия букмекера (Alpha) сканируется отдельно." },
  { name: "Book P", slug: "bookp", group: "crypto" },
  { name: "Book Q", slug: "bookq", group: "crypto" },
];
const RU_BOOKS = BOOKS.filter((b) => b.group === "ru").map((b) => b.name);
const CRYPTO_BOOKS = BOOKS.filter((b) => b.group === "crypto").map((b) => b.name);

interface BkStat { slug: string; matches: number; football: number; hockey: number; tennis: number; updatedAt: string | null }
interface BkStats { bookmakers: BkStat[]; totals: { bookmakers: number; matches: number } }

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU");
}
function ago(iso: string | null): string {
  if (!iso) return "только что";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "только что";
  if (min < 60) return `${min} ${plural(min, "минуту", "минуты", "минут")} назад`;
  const h = Math.round(min / 60);
  return `${h} ${plural(h, "час", "часа", "часов")} назад`;
}

const STEPS = [
  {
    icon: "travel_explore",
    title: "Сбор линий",
    text: "Каждые несколько минут Betmark обходит все конторы и забирает прематч-линию напрямую с их площадок: футбол и хоккей, все исходы, все турниры.",
  },
  {
    icon: "merge_type",
    title: "Сопоставление матчей",
    text: "«Ман Сити», Man City и Manchester City — один и тот же клуб. Алгоритмы транслитерации и ИИ распознают команды в любом написании и объединяют котировки в единую строку.",
  },
  {
    icon: "functions",
    title: "Расчёт Payout",
    text: "По каждому исходу система выбирает лучший коэффициент среди всех букмекеров, рассчитывает Payout % и выделяет комбинации, где Payout выше 100% — арбитражные ситуации.",
  },
  {
    icon: "table_chart",
    title: "Наглядное представление",
    text: "Единая таблица на компьютере и смартфоне: фильтры по лигам и времени, быстрый поиск, история котировок, калькулятор вилок и Live-трекер — все инструменты в одном окне.",
  },
];

const SPORTS = [
  {
    icon: "sports_soccer",
    title: "Футбол",
    text: "Ведущие лиги и еврокубки, турниры сборных и сотни региональных чемпионатов — котировки по исходам 1 / X / 2 от всех подключённых букмекеров.",
    chips: ["АПЛ", "Ла Лига", "Серия A", "Бундеслига", "Лига 1", "РПЛ", "Лига чемпионов", "Лига Европы", "Сборные"],
  },
  {
    icon: "sports_hockey",
    title: "Хоккей",
    text: "КХЛ, НХЛ и молодёжные лиги: основное время, предсезонные турниры и отдельная настройка автоматического отслеживания.",
    chips: ["КХЛ", "НХЛ", "ВХЛ", "МХЛ", "Предсезон НХЛ"],
  },
];

const AI_CARDS = [
  {
    icon: "merge",
    title: "Интеллектуальное сведение матчей",
    text: "Алгоритм сопоставления распознаёт различные варианты написания команд («Ман Сити», Man City, Manchester City) и объединяет их котировки в единую строку без дублирования.",
  },
  {
    icon: "report",
    title: "Фильтрация аномалий",
    text: "Сервис автоматически выявляет нерыночные коэффициенты, помогая вовремя заметить ошибку в линии букмекера или технический сбой.",
  },
  {
    icon: "fact_check",
    title: "Мониторинг полноты линий",
    text: "Автоматический контроль доступности событий: если у букмекера открыта линия на ведущий турнир, система проверяет её корректное отображение в таблице.",
  },
];

const BEFORE = [
  "Десятки открытых вкладок с сайтами разных букмекеров",
  "Разные названия команд — приходится сопоставлять события вручную",
  "Ручной расчёт маржи и поиск арбитражных ситуаций",
  "Неизвестно, насколько актуальны отображаемые котировки",
  "Поиск лучшего коэффициента занимает слишком много времени",
];
const AFTER = [
  "Единая таблица со всеми букмекерами на одном экране",
  "Один матч — одна строка, независимо от варианта написания команд",
  "Автоматический расчёт и индикация Payout % и арбитражных ситуаций",
  "Прозрачный статус обновления данных по каждому букмекеру",
  "Лучший коэффициент по каждому исходу наглядно выделен цветом",
];

const NEWS = [
  { icon: "new_releases", text: "В крипто-версию добавлен букмекер Book Q: футбол и хоккей." },
  { icon: "view_week", text: "Таблица автоматически адаптируется под ширину экрана — все букмекеры помещаются без горизонтальной прокрутки." },
  { icon: "swap_horiz", text: "Для Book O теперь доступны обе линии — Alpha и Beta — в соседних колонках." },
  { icon: "article", text: "В сервисе появился раздел «Что нового» с подробной историей обновлений." },
];

const FAQ = [
  {
    q: "Что такое Betmark?",
    a: "Это аналитический сервис для сравнения коэффициентов букмекеров. Каждые несколько минут платформа собирает линии подключённых площадок, объединяет одинаковые матчи в одну строку и наглядно показывает, где коэффициент выше, а маржа — ниже.",
  },
  {
    q: "Какие букмекеры подключены?",
    a: "Классические: Book A, Book B, Book C, Book D, Book E, Book F, Book G, Book H, Book I, Book L, Book K и биржа Book J. Крипто-версия: Book M, Book O (обе линии — Alpha и Beta), Book P и Book Q.",
  },
  {
    q: "Как часто обновляются коэффициенты?",
    a: "Таблица прематча обновляется каждые несколько минут, при этом ведущие лиги сканируются в приоритетном порядке. В Live-трекере во время матча коэффициенты и счёт обновляются каждые несколько секунд. Поскольку котировки меняются динамично, перед размещением ставки рекомендуем сверять актуальный коэффициент непосредственно на сайте букмекера.",
  },
  {
    q: "Что такое Payout %?",
    a: "Это теоретический процент возврата средств игрокам: чем ближе показатель к 100%, тем ниже маржа букмекера. Betmark рассчитывает Payout % по лучшим коэффициентам среди всех площадок, а при значении выше 100% — выделяет арбитражную ситуацию оранжевым цветом.",
  },
  {
    q: "Работает ли Betmark на смартфоне?",
    a: "Да. Веб-приложение можно добавить на главный экран iPhone или Android — оно открывается в полноэкранном режиме без адресной строки, а таблица автоматически адаптируется в удобные карточки матчей.",
  },
  {
    q: "Как получить доступ?",
    a: "Доступ предоставляется по приглашению. Свяжитесь с нами по адресу support@example.com — мы расскажем об условиях и поможем подключиться к платформе.",
  },
];

// Макет окна интерфейса: пример строки и сравнения (цифры - иллюстрация, не реальные линии)
const MOCK_BOOKS = ["Book A", "Book B", "Book D", "Book I", "Book M", "Book N"];
const MOCK_ROWS: { match: [string, string]; time: string; odds: number[][] }[] = [
  { match: ["Арсенал", "Челси"], time: "Сегодня, 21:00", odds: [[2.1, 3.4, 3.6], [2.12, 3.35, 3.55], [2.08, 3.45, 3.65], [2.14, 3.4, 3.5], [2.11, 3.5, 3.62], [2.09, 3.42, 3.7]] },
  { match: ["Динамо Москва", "СКА"], time: "Завтра, 17:00", odds: [[2.38, 4.0, 2.49], [2.4, 3.95, 2.46], [2.36, 4.1, 2.5], [2.42, 4.0, 2.44], [2.39, 4.05, 2.48], [2.37, 4.0, 2.52]] },
  { match: ["Интер", "Наполи"], time: "Завтра, 21:45", odds: [[2.3, 3.5, 3.2], [2.27, 3.8, 3.25], [2.32, 3.55, 3.3], [2.29, 3.6, 3.35], [2.3, 3.45, 3.3], [2.26, 3.5, 3.4]] },
  { match: ["Ювентус", "Рома"], time: "Воскресенье, 19:00", odds: [[1.95, 3.5, 4.2], [1.97, 3.45, 4.1], [1.93, 3.55, 4.3], [1.96, 3.5, 4.25], [1.94, 3.6, 4.2], [1.98, 3.5, 4.15]] },
];

function mockRow(row: (typeof MOCK_ROWS)[number]) {
  const best = [0, 1, 2].map((o) => Math.max(...row.odds.map((b) => b[o])));
  const payout = 100 / best.reduce((s, v) => s + 1 / v, 0);
  return { best, payout };
}

export default function LandingClient() {
  const heroRef = useRef<HTMLElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const scrollProgress = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [mounted, setMounted] = useState(false);
  // Публичная статистика по конторам для ленты и цифр сколько матчей сейчас сканируется и когда последнее обновление
  const [bkStats, setBkStats] = useState<BkStats | null>(null);
  const [bkError, setBkError] = useState(false);
  const [openBook, setOpenBook] = useState<Book | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/bookmakers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: BkStats) => alive && setBkStats(d))
      .catch(() => alive && setBkError(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!openBook) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenBook(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBook]);

  const statByBook = (slug: string): BkStat | undefined => bkStats?.bookmakers.find((b) => b.slug === slug);
  const totalBooks = bkStats?.totals.bookmakers ?? 0;
  const matchesRounded = bkStats ? Math.max(100, Math.floor(bkStats.totals.matches / 100) * 100) : 0;
  const STATS = [
    { value: bkStats ? String(totalBooks) : bkError ? "Десятки" : "…", label: "букмекеров отслеживаются в реальном времени" },
    { value: "2", label: "вида спорта: футбол и хоккей" },
    { value: bkStats ? `${fmtNum(matchesRounded)}+` : bkError ? "Тысячи" : "…", label: "матчей в актуальной линии" },
    { value: "Live", label: "трекер фиксирует ход матча в реальном времени" },
    { value: "24/7", label: "бесперебойная работа 24/7" },
  ];

  useEffect(() => {
    setMounted(true);
    setWebglOk(hasWebGL());

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onMqChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onMqChange);

    function onPointerMove(e: PointerEvent) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      pointer.current.x = nx;
      pointer.current.y = ny;
    }
    window.addEventListener("pointermove", onPointerMove);

    function onScroll() {
      const el = heroRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / (rect.height * 0.9)));
      scrollProgress.current = progress;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // IntersectionObserver вместо GSAP ScrollTrigger
    const els = Array.from(document.querySelectorAll<HTMLElement>(".cover-reveal"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("cover-reveal-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 60}ms`;
      io.observe(el);
    });
    return () => io.disconnect();
  }, [mounted]);

  return (
    <>
      <header className="cover-nav">
        <div className="cover-nav-inner">
          <a className="cover-brand" href="/">
            <Logo variant="dark" />
          </a>
          <nav className="cover-nav-links" aria-label="Разделы">
            <a href="#features">Возможности</a>
            <a href="#how">Принцип работы</a>
            <a href="#books">Букмекеры</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <a className="cover-btn-login" href="/login">
            Войти
          </a>
        </div>
      </header>

      <main>
      <section className="cover-hero" ref={heroRef}>
        <div className="cover-hero-canvas">
          {mounted && webglOk && (
            <HeroScene reduceMotion={reduceMotion} pointer={pointer} scrollProgress={scrollProgress} />
          )}
          {mounted && !webglOk && <div className="cover-hero-fallback" aria-hidden="true" />}
        </div>
        <div className="cover-hero-content">
          <div className="cover-eyebrow cover-reveal">Сравнение букмекеров</div>
          <h1 className="cover-title cover-reveal">
            Коэффициенты
            <br />
            всех букмекеров.
            <br />
            <span className="cover-title-accent">Одно окно.</span>
          </h1>
          <p className="cover-subtitle cover-reveal">
            Betmark объединяет линии классических и крипто-букмекеров в единую таблицу и регулярно обновляет данные. Вы сразу видите максимальные коэффициенты по рынку, реальную маржу и возникающие арбитражные ситуации — без десятков открытых вкладок и ручных расчётов.
          </p>
          <div className="cover-hero-actions cover-reveal">
            <a href="/login" className="cover-btn-primary">
              Войти в аккаунт
            </a>
            <a href="#features" className="cover-btn-ghost">
              Возможности Betmark
            </a>
          </div>
        </div>
        <div className="cover-scroll-hint" aria-hidden="true">
          <span className="msi">expand_more</span>
        </div>
      </section>

      <section className="cover-marquee" aria-label="Подключённые букмекеры" id="books">
        <div className="cover-marquee-label">
          {bkStats ? `Отслеживается ${totalBooks} ${plural(totalBooks, "букмекер", "букмекера", "букмекеров")}` : "Отслеживаются все представленные букмекеры"} — нажмите на любого из них, чтобы посмотреть статистику
        </div>
        <div className={`cover-marquee-viewport${openBook ? " is-paused" : ""}`}>
          <div className="cover-marquee-track">
            {[0, 1].map((dup) =>
              BOOKS.map((bk) => (
                <button
                  type="button"
                  className="cover-marquee-item"
                  key={`${dup}-${bk.slug}`}
                  tabIndex={dup === 1 ? -1 : 0}
                  aria-hidden={dup === 1}
                  onClick={() => setOpenBook(bk)}
                >
                  {bk.name}
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="cover-manifest">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Преимущества платформы</div>
          <h2 className="cover-section-title cover-reveal">Один экран вместо десятков вкладок</h2>
          <div className="cover-manifest-grid">
            <p className="cover-manifest-text cover-reveal">
              Букмекеры используют разные названия команд, закладывают разную маржу и обновляют котировки асинхронно. Ручной поиск лучшего предложения отнимает много времени.
            </p>
            <p className="cover-manifest-text cover-reveal">
              Betmark автоматизирует этот процесс: алгоритмы непрерывно сканируют линии, унифицируют названия клубов и турниров и сводят данные в единый терминал. Вы моментально видите лучший коэффициент, фактический Payout и историю движения линии.
            </p>
            <p className="cover-manifest-text cover-reveal">
              В дополнение к прематч-таблице доступны Live-трекер с выгрузкой PDF-отчётов, калькулятор вилок, архив движения линий и версия с крипто-букмекерами. Платформа регулярно развивается: мы подключаем новые площадки, рынки и аналитические инструменты.
            </p>
          </div>
        </div>
      </section>

      <section className="cover-features" id="features">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Преимущества</div>
          <h2 className="cover-section-title cover-reveal">Зачем нужен Betmark?</h2>
          <div className="cover-feature-grid">
            {FEATURES.map((f, i) => (
              <div className="cover-feature-card cover-reveal" key={f.title}>
                <span className="cover-feature-index">{String(i + 1).padStart(2, "0")}</span>
                <span className="cover-feature-icon-badge">
                  <span className="msi cover-feature-icon">{f.icon}</span>
                </span>
                <div className="cover-feature-title">{f.title}</div>
                <div className="cover-feature-text">{f.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-showcase">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Интерфейс</div>
          <h2 className="cover-section-title cover-reveal">Наглядное сравнение котировок</h2>
          <p className="cover-pwa-subtitle cover-reveal">
            Лучший коэффициент по каждому исходу выделен зелёным цветом, справа отображается Payout %. Если комбинация лучших котировок даёт более 100%, возникает арбитражная ситуация — показатель подсвечивается оранжевым. Обратите внимание: линии динамичны, поэтому перед ставкой рекомендуем проверять актуальный коэффициент на сайте букмекера.
          </p>
          <div className="cover-mock cover-reveal">
            <div className="cover-mock-bar">
              <span className="cover-mock-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="cover-mock-url">example.com/board</span>
              <span className="cover-mock-tag">Пример интерфейса</span>
            </div>
            <div className="cover-mock-scroll" tabIndex={0}>
              <div className="cover-mock-table" role="img" aria-label="Пример таблицы сравнения коэффициентов">
                <div className="cover-mock-row cover-mock-head">
                  <span>Матч</span>
                  <span>Начало</span>
                  {MOCK_BOOKS.map((b) => (
                    <span key={b}>{b}</span>
                  ))}
                  <span>Payout %</span>
                </div>
                {MOCK_ROWS.map((row) => {
                  const { best, payout } = mockRow(row);
                  return (
                    <div className="cover-mock-row" key={row.match.join("-")}>
                      <span className="cover-mock-match">
                        {row.match[0]}
                        <br />
                        {row.match[1]}
                      </span>
                      <span className="cover-mock-time">{row.time}</span>
                      {row.odds.map((triple, bi) => (
                        <span className="cover-mock-odds" key={bi}>
                          {triple.map((v, oi) => (
                            <b key={oi} className={v === best[oi] ? "is-best" : ""}>
                              {v.toFixed(2)}
                            </b>
                          ))}
                        </span>
                      ))}
                      <span className={`cover-mock-payout${payout > 100 ? " is-arb" : ""}`}>{payout.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="cover-mock-legend cover-reveal">
            <span>
              <i className="is-best" />
              лучший коэффициент
            </span>
            <span>
              <i className="is-arb" />
              Payout выше 100% — арбитражная ситуация
            </span>
          </div>
        </div>
      </section>

      <section className="cover-how" id="how">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Принцип работы</div>
          <h2 className="cover-section-title cover-reveal">Четыре этапа: от сбора данных до сводной таблицы</h2>
          <div className="cover-steps">
            {STEPS.map((s, i) => (
              <div className="cover-step cover-reveal" key={s.title}>
                <span className="cover-step-num">{i + 1}</span>
                <span className="cover-step-icon-badge">
                  <span className="msi">{s.icon}</span>
                </span>
                <div className="cover-step-title">{s.title}</div>
                <div className="cover-step-text">{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-sports">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Виды спорта</div>
          <h2 className="cover-section-title cover-reveal">Футбол и хоккей</h2>
          <div className="cover-sports-grid">
            {SPORTS.map((s) => (
              <div className="cover-sport-card cover-reveal" key={s.title}>
                <span className="cover-sport-icon msi">{s.icon}</span>
                <div className="cover-sport-title">{s.title}</div>
                <p className="cover-sport-text">{s.text}</p>
                <div className="cover-book-chips">
                  {s.chips.map((c) => (
                    <span className="cover-book-chip" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-live">
        <div className="cover-section-inner cover-live-inner">
          <div className="cover-live-copy">
            <div className="cover-eyebrow cover-reveal">Live-трекер</div>
            <h2 className="cover-live-title cover-reveal">Полная хронология матча в реальном времени</h2>
            <p className="cover-live-text cover-reveal">
              Выберите матч, и трекер начнёт фиксировать счёт, время игры и котировки сразу у нескольких букмекеров с интервалом в несколько секунд. Голы, колебания коэффициентов и движение линии сохраняются в единую историю, на основе которой формируется подробный PDF-отчёт — он доступен для скачивания как после, так и во время игры.
            </p>
            <ul className="cover-live-list cover-reveal">
              <li>
                <span className="msi">check_circle</span>
                Классические и крипто-букмекеры в едином трекере
              </li>
              <li>
                <span className="msi">check_circle</span>
                Четыре уровня детализации отчёта
              </li>
              <li>
                <span className="msi">check_circle</span>
                Автоматическое отслеживание выбранных лиг
              </li>
            </ul>
          </div>
          <div className="cover-live-card cover-reveal" aria-label="Пример карточки Live-трекера">
            <div className="cover-live-head">
              <span className="cover-live-badge">
                <i /> LIVE
              </span>
              <span className="cover-live-minute">67&apos;</span>
              <span className="cover-mock-tag">Пример</span>
            </div>
            <div className="cover-live-score">
              <span>Спартак</span>
              <b>1 : 0</b>
              <span>Зенит</span>
            </div>
            <div className="cover-live-rows">
              {[
                ["Book A", "1.62", "up"],
                ["Book I", "1.65", "up"],
                ["Book D", "1.60", "down"],
                ["Book B", "1.63", "up"],
              ].map(([n, v, d]) => (
                <div className="cover-live-row" key={n}>
                  <span>{n}</span>
                  <b>{v}</b>
                  <span className={`cover-live-delta is-${d}`}>{d === "up" ? "▲" : "▼"}</span>
                </div>
              ))}
            </div>
            <div className="cover-live-foot">
              <span className="msi">picture_as_pdf</span>
              Автоматическое формирование PDF-отчёта
            </div>
          </div>
        </div>
      </section>

      <section className="cover-ai">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Интеллектуальный контроль</div>
          <h2 className="cover-section-title cover-reveal">Автоматическая проверка качества данных</h2>
          <div className="cover-ai-grid">
            {AI_CARDS.map((c) => (
              <div className="cover-ai-card cover-reveal" key={c.title}>
                <span className="cover-feature-icon-badge">
                  <span className="msi cover-feature-icon">{c.icon}</span>
                </span>
                <div className="cover-ai-title">{c.title}</div>
                <div className="cover-ai-text">{c.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-versions">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Две версии</div>
          <h2 className="cover-section-title cover-reveal">Betmark и Крипто Betmark</h2>
          <p className="cover-pwa-subtitle cover-reveal">
            Единый аккаунт и общая база матчей — выбирайте нужный сегмент букмекеров для работы.
          </p>
          <div className="cover-pwa-grid">
            <div className="cover-pwa-card cover-reveal">
              <div className="cover-pwa-platform">
                <span className="msi">sports_soccer</span>
                Betmark — классические букмекеры
              </div>
              <div className="cover-book-chips">
                {RU_BOOKS.map((n) => (
                  <span className="cover-book-chip" key={n}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
            <div className="cover-pwa-card cover-reveal">
              <div className="cover-pwa-platform">
                <span className="msi">currency_bitcoin</span>
                Крипто Betmark — крипто-букмекеры
              </div>
              <div className="cover-book-chips">
                {CRYPTO_BOOKS.map((n) => (
                  <span className="cover-book-chip" key={n}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cover-compare">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Сравнение подхода</div>
          <h2 className="cover-section-title cover-reveal">Эффективность в деталях</h2>
          <div className="cover-compare-grid">
            <div className="cover-compare-card cover-compare-before cover-reveal">
              <div className="cover-compare-head">
                <span className="msi">close</span>
                Без Betmark
              </div>
              <ul>
                {BEFORE.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="cover-compare-card cover-compare-after cover-reveal">
              <div className="cover-compare-head">
                <span className="msi">check</span>С Betmark
              </div>
              <ul>
                {AFTER.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="cover-stats">
        <div className="cover-section-inner cover-stats-row">
          {STATS.map((s) => (
            <div className="cover-stat cover-reveal" key={s.label}>
              <div className="cover-stat-value">{s.value}</div>
              <div className="cover-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="cover-news">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Развитие</div>
          <h2 className="cover-section-title cover-reveal">Постоянное развитие платформы</h2>
          <p className="cover-pwa-subtitle cover-reveal">
            С момента запуска 27 августа функционал сервиса значительно расширился — от первых шести букмекеров до крипто-платформы, Live-трекера и интеллектуального контроля данных. Последние обновления:
          </p>
          <div className="cover-news-grid">
            {NEWS.map((n) => (
              <div className="cover-news-card cover-reveal" key={n.text}>
                <span className="cover-news-icon msi">{n.icon}</span>
                <span>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-pwa">
        <div className="cover-section-inner">
          <h2 className="cover-section-title cover-reveal">Установите Betmark на смартфон</h2>
          <p className="cover-pwa-subtitle cover-reveal">
            Работает как полнофункциональное приложение — запуск с главного экрана, без адресной строки браузера.
          </p>
          <div className="cover-pwa-grid">
            <div className="cover-pwa-card cover-reveal">
              <div className="cover-pwa-platform">
                <span className="msi">phone_iphone</span>
                iPhone (Safari)
              </div>
              <ol className="cover-pwa-steps">
                {PWA_STEPS.ios.map((s) => (
                  <li key={s.text}>
                    <span className="cover-pwa-step-icon msi">{s.icon}</span>
                    {s.text}
                  </li>
                ))}
              </ol>
            </div>
            <div className="cover-pwa-card cover-reveal">
              <div className="cover-pwa-platform">
                <span className="msi">phone_android</span>
                Android (Chrome)
              </div>
              <ol className="cover-pwa-steps">
                {PWA_STEPS.android.map((s) => (
                  <li key={s.text}>
                    <span className="cover-pwa-step-icon msi">{s.icon}</span>
                    {s.text}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="cover-faq" id="faq">
        <div className="cover-section-inner">
          <div className="cover-eyebrow cover-eyebrow-center cover-reveal">Вопросы и ответы</div>
          <h2 className="cover-section-title cover-reveal">Частые вопросы</h2>
          <div className="cover-faq-list">
            {FAQ.map((f) => (
              <details className="cover-faq-item cover-reveal" key={f.q}>
                <summary>
                  <span>{f.q}</span>
                  <span className="msi cover-faq-chevron">expand_more</span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="cover-contact">
        <div className="cover-section-inner cover-reveal">
          <div className="cover-contact-panel">
            <span className="msi cover-contact-icon">mail</span>
            <h2 className="cover-contact-title">Остались вопросы?</h2>
            <p className="cover-contact-text">Свяжитесь со службой поддержки — мы поможем разобраться с функционалом и настроить инструменты под ваши задачи.</p>
            {/* Реальный адрес прислан пользователем - заменяет прежнюю заглушку "Почта появится здесь совсем скоро" */}
            <a className="cover-contact-chip" href="mailto:support@example.com">
              <span className="msi">alternate_email</span>
              support@example.com
            </a>
          </div>
        </div>
      </section>

      <section className="cover-final">
        <div className="cover-section-inner cover-final-inner cover-reveal">
          <span className="msi cover-final-icon">sports_soccer</span>
          <h2 className="cover-final-title">Перейти к сравнению коэффициентов?</h2>
          <a href="/login" className="cover-btn-primary">
            Войти в аккаунт
          </a>
        </div>
      </section>

      </main>

      {openBook && (
        <div
          className="cover-bk-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenBook(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={openBook.name}
        >
          <div className="cover-bk-card">
            <button type="button" className="cover-bk-close" aria-label="Закрыть" onClick={() => setOpenBook(null)}>
              <span className="msi">close</span>
            </button>
            <div className="cover-bk-group">{openBook.label ?? (openBook.group === "ru" ? "Классический букмекер" : "Крипто-букмекер")}</div>
            <div className="cover-bk-name">{openBook.name}</div>
            {(() => {
              const st = statByBook(openBook.slug);
              if (!st) return <div className="cover-bk-sub">{bkError ? "Не удалось загрузить данные. Пожалуйста, обновите страницу." : "Загрузка данных…"}</div>;
              const sports: [string, string, number][] = [
                ["sports_soccer", "Футбол", st.football],
                ["sports_hockey", "Хоккей", st.hockey],
              ];
              return (
                <>
                  <div className="cover-bk-big">
                    <b>{fmtNum(st.matches)}</b> {plural(st.matches, "матч", "матча", "матчей")}
                  </div>
                  <div className="cover-bk-sub">сейчас отслеживается в Betmark и сопоставляется с другими букмекерами</div>
                  <ul className="cover-bk-sports">
                    {sports.map(([icon, label, n]) => (
                      <li key={label} className={n > 0 ? "" : "is-empty"}>
                        <span className="msi">{icon}</span>
                        {label}
                        <b>{n > 0 ? fmtNum(n) : "линия отсутствует"}</b>
                      </li>
                    ))}
                  </ul>
                  <div className="cover-bk-upd">Последнее обновление линии: {ago(st.updatedAt)}</div>
                </>
              );
            })()}
            {openBook.note && <div className="cover-bk-note">{openBook.note}</div>}
          </div>
        </div>
      )}
    </>
  );
}

// Инструкция по установке PWA. iOS/Safari не показывает системный баннер "Установить" сам
const PWA_STEPS = {
  ios: [
    { icon: "ios_share", text: "В браузере Safari нажмите значок «Поделиться» в нижней части экрана" },
    { icon: "add_box", text: "В меню выберите пункт «На экран «Домой»»" },
    { icon: "check_circle", text: "Нажмите «Добавить» — иконка Betmark появится на главном экране" },
  ],
  android: [
    { icon: "more_vert", text: "В браузере Chrome откройте меню (три точки в правом верхнем углу)" },
    { icon: "install_mobile", text: "Выберите «Установить приложение» (или «Добавить на главный экран»)" },
    { icon: "check_circle", text: "Подтвердите действие — Betmark будет запускаться как отдельное приложение" },
  ],
} as const;
