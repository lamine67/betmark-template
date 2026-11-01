"use client";

import { useState } from "react";
import { useBetmarkPerms } from "@/lib/useBetmarkPerms";
import Loader from "../../components/Loader";

export interface ProxyClient {
  id: string;
  port: number;
  connected: boolean;
  connected_since?: string | null;
  remote_ip?: string | null;
  proxy_user?: string | null;
  proxy_password?: string | null;
  name?: string | null;
  remote_id?: string | null;
  provider?: string | null;
  provider_login?: string | null;
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function CopyIcon({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      className="msi proxy-conn-copy"
      title="Скопировать"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          alert("Не удалось скопировать — браузер отклонил доступ к буферу обмена");
        }
      }}
    >
      {copied ? "check" : "content_copy"}
    </span>
  );
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions">
          <button className="confirm-btn-cancel" onClick={onCancel}>
            Отмена
          </button>
          <button className="confirm-btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProxyRow({
  client,
  onChange,
  onRequestDelete,
  canRename,
  canDelete,
}: {
  client: ProxyClient;
  onChange: () => void;
  onRequestDelete: (client: ProxyClient) => void;
  canRename: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client.name || "");
  const [remoteId, setRemoteId] = useState(client.remote_id || "");
  const [provider, setProvider] = useState(client.provider || "");
  const [providerLogin, setProviderLogin] = useState(client.provider_login || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/proxies/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: client.id,
          name,
          remote_id: remoteId,
          provider,
          provider_login: providerLogin,
        }),
      });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  const displayName = client.name || client.id;

  return (
    <div className="proxy-item">
      <div className="proxy-row" onClick={() => setOpen((v) => !v)}>
        <div className="proxy-row-main">
          <div className="proxy-row-name">
            {displayName}
            <div className="proxy-row-sub">
              {client.id}
              {client.remote_id ? ` · Remote: ${client.remote_id}` : ""}
            </div>
          </div>
          <div className="proxy-row-ip">{client.remote_ip || "—"}</div>
          <div className="proxy-row-provider">{client.provider || "—"}</div>
          <div className="proxy-row-status">
            <span className={`proxy-status-badge ${client.connected ? "online" : "offline"}`}>
              {client.connected ? "В сети" : "Не в сети"}
            </span>
          </div>
          <div className="proxy-row-since">{client.connected_since ? fmtRelative(client.connected_since) : "—"}</div>
        </div>
        <div className="proxy-row-actions">
          <span className="msi proxy-chevron-icon">{open ? "expand_less" : "expand_more"}</span>
          {canDelete && (
            <span
              className="msi proxy-delete-icon"
              title="Удалить ПК"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(client);
              }}
            >
              delete
            </span>
          )}
        </div>
      </div>
      {open && (
        <div className="proxy-detail-card" onClick={(e) => e.stopPropagation()}>
          {client.connected ? (
            <>
              <div className="proxy-conn-grid">
                <div className="proxy-conn-item">
                  <span className="proxy-conn-label">Адрес</span>
                  <span className="proxy-conn-value-row">
                    <span className="proxy-conn-value">example.com:{client.port}</span>
                    <CopyIcon value={`example.com:${client.port}`} />
                  </span>
                </div>
                <div className="proxy-conn-item">
                  <span className="proxy-conn-label">Логин</span>
                  <span className="proxy-conn-value-row">
                    <span className="proxy-conn-value">{client.proxy_user}</span>
                    <CopyIcon value={client.proxy_user || ""} />
                  </span>
                </div>
                <div className="proxy-conn-item">
                  <span className="proxy-conn-label">Пароль</span>
                  <span className="proxy-conn-value-row">
                    <span className="proxy-conn-value">{client.proxy_password}</span>
                    <CopyIcon value={client.proxy_password || ""} />
                  </span>
                </div>
              </div>
              <div className="proxy-hint">Работает и как SOCKS5, и как HTTP-прокси на одном порту.</div>
            </>
          ) : (
            <div className="proxy-hint">
              ПК не в сети — адрес, логин и пароль прокси появятся, когда снова подключится.
            </div>
          )}
          <div className="proxy-detail-grid">
            <label className="proxy-field">
              <span>Имя</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={client.id} disabled={!canRename} />
            </label>
            <label className="proxy-field">
              <span>Remote ID</span>
              <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder="например, 123 456 789" disabled={!canRename} />
            </label>
            <label className="proxy-field">
              <span>Провайдер</span>
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="например, Ростелеком" disabled={!canRename} />
            </label>
            <label className="proxy-field">
              <span>Логин провайдера</span>
              <input
                value={providerLogin}
                onChange={(e) => setProviderLogin(e.target.value)}
                placeholder="логин для личного кабинета"
                disabled={!canRename}
              />
            </label>
          </div>
          {canRename && (
            <div className="proxy-detail-actions">
              <button className="proxy-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader inline size={16} /> Сохраняю…
                  </>
                ) : (
                  "Сохранить"
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProxyTable({ initialClients }: { initialClients: ProxyClient[] }) {
  const [clients, setClients] = useState(initialClients);
  const [pendingDelete, setPendingDelete] = useState<ProxyClient | null>(null);
  const { perms } = useBetmarkPerms();

  async function refresh() {
    const res = await fetch("/api/proxies/status", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setClients(data.clients || []);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch("/api/proxies/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: id }),
    });
    refresh();
  }

  const total = clients.length;
  const online = clients.filter((c) => c.connected).length;

  return (
    <div className="proxies-wrap">
      <div className="proxies-stats">
        <div className="proxies-stat">
          <div className="proxies-stat-value">{total}</div>
          <div className="proxies-stat-label">Всего ПК</div>
        </div>
        <div className="proxies-stat accent">
          <div className="proxies-stat-value">{online}</div>
          <div className="proxies-stat-label">В сети сейчас</div>
        </div>
        <div className="proxies-stat">
          <div className="proxies-stat-value">{total - online}</div>
          <div className="proxies-stat-label">Не в сети</div>
        </div>
      </div>
      {clients.length === 0 ? (
        <div className="proxy-hint">Пока ни один ПК не подключался</div>
      ) : (
        <div className="proxy-list">
          {clients.map((c) => (
            <ProxyRow
              key={c.id}
              client={c}
              onChange={refresh}
              onRequestDelete={setPendingDelete}
              canRename={perms.proxies_rename}
              canDelete={perms.proxies_delete}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Удалить ПК?"
        message={`Удалить «${pendingDelete?.name || pendingDelete?.id}» из списка? Если на нём сейчас запущен HomeProxy, он появится снова при следующем подключении — уже с новым портом.`}
        confirmLabel="Удалить"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
