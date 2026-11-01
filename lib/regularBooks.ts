// Правило "чёрного списка" "если матч есть только в 1 конторе из списка обычные, то это сразу в блек лист")
import { isCryptoSlug } from "./cryptoBooks";

export const MIN_REGULAR_BOOKS = 2;

export function regularBookCount(slugs: Iterable<string>): number {
  return new Set([...slugs].filter((s) => !isCryptoSlug(s))).size;
}

export function passesRegularBooksGate(slugs: Iterable<string>): boolean {
  return regularBookCount(slugs) >= MIN_REGULAR_BOOKS;
}
