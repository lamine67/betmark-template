import type { MetadataRoute } from "next";

// Для поисковиков открыты только главная и страница входа; сам инструмент закрыт логином
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login"], disallow: ["/api/", "/board", "/live", "/status", "/match/", "/forks", "/whats-new", "/proxies"] }],
  };
}
