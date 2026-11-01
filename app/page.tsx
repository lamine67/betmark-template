import type { Metadata, Viewport } from "next";
import LandingClient from "../components/LandingClient";

export const metadata: Metadata = {
  title: "Betmark — сервис сравнения коэффициентов букмекеров",
  description: "Betmark объединяет линии классических и крипто-букмекеров в единую таблицу: лучшие коэффициенты, Payout %, вилки, Live-трекер и история движения линий.",
};

// См. app/login/page.tsx - тот же приём: обложка тоже тёмная (.cover-page)
export const viewport: Viewport = {
  themeColor: "#06110c",
};

export default function CoverPage() {
  return (
    <div className="cover-page">
      <LandingClient />
    </div>
  );
}
