"use client";
import { useEffect, useState } from "react";

const FALLBACK_NOT_PARSED: ReadonlySet<string> = new Set(["bookr", "booku", "books", "bookt", "rainbet", "cloudbet"]);

let cache: Set<string> | null = null;
let inflight = false;
const subscribers = new Set<() => void>();

function load() {
  if (cache || inflight) return;
  inflight = true;
  fetch("/api/active-bookmakers")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (Array.isArray(j?.slugs)) {
        cache = new Set((j.slugs as unknown[]).filter((x): x is string => typeof x === "string"));
        subscribers.forEach((f) => f());
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = false;
    });
}

export function useParsedBooks(): (slug: string) => boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    subscribers.add(f);
    load();
    return () => {
      subscribers.delete(f);
    };
  }, []);
  return (slug: string) => (cache ? cache.has(slug) : !FALLBACK_NOT_PARSED.has(slug));
}
