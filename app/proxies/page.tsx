import { redirect } from "next/navigation";

// Список прокси переехал во вкладку «Прокси» страницы «Статус»
export default function ProxiesPage() {
  redirect("/status#proxies");
}
