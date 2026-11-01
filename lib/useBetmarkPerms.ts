// Клиентский хук для гранулярных прав Betmark
"use client";

import { useEffect, useState } from "react";
import { BETMARK_PERM_KEYS, type BetmarkPermKey, type BetmarkPerms } from "@/lib/betmarkPermKeys";

export type { BetmarkPermKey, BetmarkPerms };

interface UseBetmarkPermsResult {
  perms: BetmarkPerms;
  hasAccess: boolean;
  loading: boolean;
}

// Пока ответ ещё не пришёл - разрешаем всё (тот же принцип, что и дефолт на бэкенде для несохранённых прав)
const OPTIMISTIC_PERMS: BetmarkPerms = Object.fromEntries(BETMARK_PERM_KEYS.map((k) => [k, true])) as BetmarkPerms;

export function useBetmarkPerms(): UseBetmarkPermsResult {
  const [perms, setPerms] = useState<BetmarkPerms>(OPTIMISTIC_PERMS);
  const [hasAccess, setHasAccess] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/permissions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPerms(data.perms);
        setHasAccess(!!data.hasAccess);
      })
      .catch(() => {
        // Сеть подвела - оставляем оптимистичные права, сервер всё равно отфильтрует лишнее
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { perms, hasAccess, loading };
}
