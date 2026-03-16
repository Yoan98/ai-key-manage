"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FaBolt,
  FaCheckCircle,
  FaCopy,
  FaEdit,
  FaFileExport,
  FaSave,
  FaKey,
  FaLink,
  FaMagic,
  FaPaste,
  FaShieldAlt,
  FaSpinner,
  FaTag,
  FaTimesCircle,
  FaTrashAlt,
  FaVial
} from "react-icons/fa";

type KeyConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
};

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ExportType = "md" | "txt";
type TestStatus = "idle" | "pending" | "success" | "error";

type TestResult = {
  status: TestStatus;
  message: string;
  detail?: string;
};

const STORAGE_KEY = "ai-key-vault-configs-v1";
const PASS_TEXT = "主人，快鞭策我吧";
const FAIL_TEXT = "主人，我不行了";

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function toMaskedKey(key: string): string {
  if (key.length <= 10) return "******";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function makeDefaultName(baseUrl: string, index: number): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, "");
    return `${host}-${index}`;
  } catch {
    return `配置-${index}`;
  }
}

function parsePasteText(input: string): Partial<FormState> {
  const text = input.trim();
  if (!text) return {};

  const out: Partial<FormState> = {};

  const keyPatterns = [
    /api[_-]?key["'\s:=]+([A-Za-z0-9._-]{10,})/i,
    /bearer\s+([A-Za-z0-9._-]{10,})/i,
    /key["'\s:=]+([A-Za-z0-9._-]{10,})/i
  ];
  for (const p of keyPatterns) {
    const m = text.match(p);
    if (m?.[1]) {
      out.apiKey = m[1];
      break;
    }
  }
  if (!out.apiKey) {
    const fallback = text.match(/(?:sk|rk|ak|pk)[-_][A-Za-z0-9._-]{8,}/i);
    if (fallback) out.apiKey = fallback[0];
  }

  const urlMatch = text.match(/https?:\/\/[^\s"'`]+/i);
  if (urlMatch?.[0]) {
    out.baseUrl = normalizeBaseUrl(urlMatch[0]);
  } else {
    const hostLike = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'`]*)?/i);
    if (hostLike?.[0]) out.baseUrl = normalizeBaseUrl(hostLike[0]);
  }

  const nameMatch = text.match(/name["'\s:=]+([^\n\r,;]+)/i);
  if (nameMatch?.[1]) out.name = nameMatch[1].trim();

  const modelMatch = text.match(/model["'\s:=]+([A-Za-z0-9._:-]+)/i);
  if (modelMatch?.[1]) out.model = modelMatch[1].trim();

  return out;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatConfig(item: KeyConfig, type: ExportType): string {
  if (type === "md") {
    return [
      `## ${item.name}`,
      "",
      `- 地址: ${item.baseUrl}`,
      `- Key: ${item.apiKey}`,
      `- 模型: ${item.model || "(未设置)"}`,
      `- 创建时间: ${item.createdAt}`,
      ""
    ].join("\n");
  }
  return [
    `名称: ${item.name}`,
    `地址: ${item.baseUrl}`,
    `Key: ${item.apiKey}`,
    `模型: ${item.model || "(未设置)"}`,
    `创建时间: ${item.createdAt}`,
    ""
  ].join("\n");
}

function formatAll(configs: KeyConfig[], type: ExportType): string {
  if (configs.length === 0) return "";
  if (type === "md") {
    return [
      "# AI API Key 配置导出",
      "",
      ...configs.map((item) => formatConfig(item, type))
    ].join("\n");
  }
  return [
    "AI API Key 配置导出",
    "====================",
    "",
    ...configs.map((item, idx) => [`[${idx + 1}]`, formatConfig(item, type)].join("\n"))
  ].join("\n");
}

function defaultTestResult(): TestResult {
  return { status: "idle", message: "未测试" };
}

function statusClass(status: TestStatus): string {
  if (status === "success") return "status-pill success";
  if (status === "error") return "status-pill error";
  if (status === "pending") return "status-pill pending";
  return "status-pill idle";
}

function StatusIcon({ status }: { status: TestStatus }) {
  if (status === "success") return <FaCheckCircle aria-hidden />;
  if (status === "error") return <FaTimesCircle aria-hidden />;
  if (status === "pending") return <FaSpinner className="spin" aria-hidden />;
  return <FaVial aria-hidden />;
}

export default function Home() {
  const [configs, setConfigs] = useState<KeyConfig[]>([]);
  const [form, setForm] = useState<FormState>({ name: "", baseUrl: "", apiKey: "", model: "" });
  const [pasteRaw, setPasteRaw] = useState("");
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [resultMap, setResultMap] = useState<Record<string, TestResult>>({});
  const [notice, setNotice] = useState("");
  const [testingAll, setTestingAll] = useState(false);
  const [exportType, setExportType] = useState<ExportType>("md");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>({ name: "", baseUrl: "", apiKey: "", model: "" });
  const [quickModelMap, setQuickModelMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as KeyConfig[];
      setConfigs(Array.isArray(parsed) ? parsed : []);
    } catch {
      setConfigs([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }, [configs]);

  useEffect(() => {
    setQuickModelMap((prev) => {
      const next: Record<string, string> = {};
      for (const item of configs) {
        next[item.id] = prev[item.id] ?? item.model ?? "";
      }
      return next;
    });
  }, [configs]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const nextIndex = useMemo(() => configs.length + 1, [configs.length]);

  function applyPaste() {
    const parsed = parsePasteText(pasteRaw);
    const merged: FormState = {
      name: parsed.name?.trim() || form.name,
      baseUrl: parsed.baseUrl?.trim() || form.baseUrl,
      apiKey: parsed.apiKey?.trim() || form.apiKey,
      model: parsed.model?.trim() || form.model
    };
    if (!merged.name && merged.baseUrl) {
      merged.name = makeDefaultName(merged.baseUrl, nextIndex);
    }
    setForm(merged);
    setNotice("已解析到表单");
  }

  function addItem(name: string, baseUrl: string, apiKey: string, model: string) {
    const item: KeyConfig = {
      id: crypto.randomUUID(),
      name,
      baseUrl,
      apiKey,
      model,
      createdAt: new Date().toISOString()
    };
    setConfigs((prev) => [item, ...prev]);
    setForm({ name: "", baseUrl: "", apiKey: "", model: "" });
    setPasteRaw("");
  }

  function addFromPaste() {
    const parsed = parsePasteText(pasteRaw);
    const baseUrl = normalizeBaseUrl((parsed.baseUrl || "").trim());
    const apiKey = (parsed.apiKey || "").trim();
    const model = (parsed.model || "").trim();
    if (!baseUrl || !apiKey) {
      setNotice("未识别到完整地址和 Key");
      return;
    }
    const name = (parsed.name || "").trim() || makeDefaultName(baseUrl, nextIndex);
    addItem(name, baseUrl, apiKey, model);
    setNotice("已从粘贴内容新增");
  }

  function addConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const baseUrl = normalizeBaseUrl(form.baseUrl);
    const apiKey = form.apiKey.trim();
    const model = form.model.trim();
    let name = form.name.trim();
    if (!baseUrl || !apiKey) return;
    if (!name) name = makeDefaultName(baseUrl, nextIndex);

    addItem(name, baseUrl, apiKey, model);
    setNotice("保存成功");
  }

  function removeConfig(id: string) {
    setConfigs((prev) => prev.filter((i) => i.id !== id));
    setResultMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setNotice("已删除");
  }

  async function runTest(item: KeyConfig): Promise<boolean> {
    setLoadingMap((prev) => ({ ...prev, [item.id]: true }));
    setResultMap((prev) => ({
      ...prev,
      [item.id]: { status: "pending", message: "测试中..." }
    }));

    try {
      const resp = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: item.baseUrl, apiKey: item.apiKey, model: item.model })
      });
      const data = (await resp.json()) as { ok: boolean; message: string };

      if (data.ok) {
        setResultMap((prev) => ({
          ...prev,
          [item.id]: { status: "success", message: PASS_TEXT, detail: data.message }
        }));
        return true;
      }

      setResultMap((prev) => ({
        ...prev,
        [item.id]: { status: "error", message: FAIL_TEXT, detail: data.message }
      }));
      return false;
    } catch {
      setResultMap((prev) => ({
        ...prev,
        [item.id]: { status: "error", message: FAIL_TEXT, detail: "请求失败，请检查网络或地址" }
      }));
      return false;
    } finally {
      setLoadingMap((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function testConfig(item: KeyConfig) {
    const ok = await runTest(item);
    setNotice(ok ? `${item.name} 测试通过` : `${item.name} 测试失败`);
  }

  async function testAllConfigs() {
    if (configs.length === 0) {
      setNotice("暂无配置可测试");
      return;
    }
    setTestingAll(true);
    setNotice("开始测试全部配置...");
    const result = await Promise.all(configs.map((item) => runTest(item)));
    const passCount = result.filter(Boolean).length;
    const failCount = result.length - passCount;
    setTestingAll(false);
    setNotice(`测试完成：通过 ${passCount}，失败 ${failCount}`);
  }

  async function copyText(text: string, okText: string) {
    if (!text) {
      setNotice("没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(okText);
    } catch {
      setNotice("复制失败，请检查浏览器权限");
    }
  }

  function downloadText(filename: string, content: string) {
    if (!content) {
      setNotice("没有可导出的内容");
      return;
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("导出完成");
  }

  function exportOne(item: KeyConfig) {
    const filename = `${sanitizeFilename(item.name || "ai-key")}.${exportType}`;
    const content = formatConfig(item, exportType);
    downloadText(filename, content);
  }

  function exportAll() {
    const content = formatAll(configs, exportType);
    const filename = `ai-key-configs.${exportType}`;
    downloadText(filename, content);
  }

  function startEdit(item: KeyConfig) {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      model: item.model
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ name: "", baseUrl: "", apiKey: "", model: "" });
  }

  function saveEdit(id: string) {
    const baseUrl = normalizeBaseUrl(editForm.baseUrl);
    const apiKey = editForm.apiKey.trim();
    const name = editForm.name.trim();
    const model = editForm.model.trim();

    if (!baseUrl || !apiKey) {
      setNotice("编辑保存失败：地址和 Key 不能为空");
      return;
    }

    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              name: name || item.name,
              baseUrl,
              apiKey,
              model
            }
          : item
      )
    );

    cancelEdit();
    setNotice("已保存编辑");
  }

  function quickSaveModel(id: string) {
    const nextModel = (quickModelMap[id] || "").trim();
    setConfigs((prev) => prev.map((item) => (item.id === id ? { ...item, model: nextModel } : item)));
    setNotice("模型名已更新");
  }

  return (
    <main className="page">
      <header className="hero">
        <h1>
          <FaShieldAlt aria-hidden />
          <span>AI Key Vault</span>
        </h1>
        <p>本地保存、批量测试、复制与导出</p>
      </header>

      <section className="purpose-banner" aria-label="页面说明">
        <p className="purpose-title">这是你的 AI API Key 本地保险箱</p>
        <p className="purpose-subtitle">统一管理名称/地址/Key/模型，支持一键测全部和单条测试，数据仅存浏览器本地。</p>
      </section>

      <section className="panel panel-form">
        <div className="panel-head">
          <h2>新增配置</h2>
          <span>{configs.length} 条配置</span>
        </div>

        <label className="label">粘贴内容（自动识别地址、Key、模型）</label>
        <textarea
          value={pasteRaw}
          onChange={(e) => setPasteRaw(e.target.value)}
          placeholder="可粘贴 curl、JSON、环境变量等内容"
          rows={5}
        />

        <div className="toolbar">
          <button type="button" className="ghost" onClick={applyPaste}>
            <FaMagic aria-hidden />
            <span>解析到表单</span>
          </button>
          <button type="button" className="primary" onClick={addFromPaste}>
            <FaPaste aria-hidden />
            <span>粘贴并直接新增</span>
          </button>
        </div>

        <form onSubmit={addConfig} className="form">
          <label className="label">名称</label>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="例如：OpenAI-主账号"
          />

          <label className="label">地址</label>
          <input
            value={form.baseUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="例如：https://api.openai.com/v1"
            required
          />

          <label className="label">Key</label>
          <input
            value={form.apiKey}
            onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder="例如：sk-xxxx"
            required
          />

          <label className="label">模型（可选）</label>
          <input
            value={form.model}
            onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
            placeholder="例如：gpt-4.1-mini"
          />

          <div className="toolbar">
            <button type="submit" className="primary">
              <FaSave aria-hidden />
              <span>保存配置</span>
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head list-head">
          <h2>配置列表</h2>
          <div className="toolbar compact">
            <button type="button" className="primary" onClick={testAllConfigs} disabled={testingAll}>
              {testingAll ? <FaSpinner className="spin" aria-hidden /> : <FaBolt aria-hidden />}
              <span>{testingAll ? "测试中" : "一键测试全部"}</span>
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => copyText(formatAll(configs, "txt"), "已复制全部配置")}
            >
              <FaCopy aria-hidden />
              <span>复制全部</span>
            </button>
            <select
              className="select"
              value={exportType}
              onChange={(e) => setExportType(e.target.value as ExportType)}
              aria-label="导出格式"
            >
              <option value="md">导出格式：Markdown (.md)</option>
              <option value="txt">导出格式：Text (.txt)</option>
            </select>
            <button type="button" className="ghost" onClick={exportAll}>
              <FaFileExport aria-hidden />
              <span>导出</span>
            </button>
          </div>
        </div>

        {notice ? <div className="notice">{notice}</div> : null}

        {configs.length === 0 ? (
          <p className="empty">暂无配置</p>
        ) : (
          <ul className="list">
            {configs.map((item) => {
              const testing = loadingMap[item.id];
              const result = resultMap[item.id] || defaultTestResult();
              const isEditing = editingId === item.id;

              return (
                <li key={item.id} className="item">
                  <div className="item-main">
                    {isEditing ? (
                      <div className="edit-box">
                        <label className="label">名称</label>
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        />

                        <label className="label">地址</label>
                        <input
                          value={editForm.baseUrl}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                        />

                        <label className="label">Key</label>
                        <input
                          value={editForm.apiKey}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                        />

                        <label className="label">模型</label>
                        <input
                          value={editForm.model}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, model: e.target.value }))}
                        />

                        <div className="toolbar">
                          <button type="button" className="primary" onClick={() => saveEdit(item.id)}>
                            <FaSave aria-hidden />
                            <span>保存编辑</span>
                          </button>
                          <button type="button" className="ghost" onClick={cancelEdit}>
                            <FaTimesCircle aria-hidden />
                            <span>取消</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="item-title">{item.name}</div>

                        <div className="item-row">
                          <span className="k">
                            <FaLink aria-hidden /> 地址
                          </span>
                          <span className="v">{item.baseUrl}</span>
                        </div>

                        <div className="item-row">
                          <span className="k">
                            <FaKey aria-hidden /> Key
                          </span>
                          <span className="v mono">{toMaskedKey(item.apiKey)}</span>
                        </div>

                        <div className="item-row">
                          <span className="k">
                            <FaTag aria-hidden /> 模型
                          </span>
                          <div className="quick-model">
                            <input
                              value={quickModelMap[item.id] || ""}
                              onChange={(e) =>
                                setQuickModelMap((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                              placeholder="快速修改模型名"
                            />
                            <button
                              type="button"
                              className="ghost mini"
                              onClick={() => quickSaveModel(item.id)}
                            >
                              <FaSave aria-hidden />
                              <span>快速保存模型</span>
                            </button>
                          </div>
                        </div>

                        <div className="item-row">
                          <span className="k">
                            <FaVial aria-hidden /> 状态
                          </span>
                          <div className="result-block">
                            <span className={statusClass(result.status)}>
                              <StatusIcon status={result.status} />
                              <span>{result.message}</span>
                            </span>
                            {result.detail ? <span className="result-detail">{result.detail}</span> : null}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditing ? (
                    <div className="item-actions">
                      <button type="button" className="ghost" onClick={() => testConfig(item)} disabled={testing}>
                        {testing ? <FaSpinner className="spin" aria-hidden /> : <FaBolt aria-hidden />}
                        <span>{testing ? "测试中" : "测试"}</span>
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyText(formatConfig(item, "txt"), `已复制：${item.name}`)}
                      >
                        <FaCopy aria-hidden />
                        <span>复制</span>
                      </button>
                      <button type="button" className="ghost" onClick={() => exportOne(item)}>
                        <FaFileExport aria-hidden />
                        <span>导出</span>
                      </button>
                      <button type="button" className="ghost" onClick={() => startEdit(item)}>
                        <FaEdit aria-hidden />
                        <span>编辑</span>
                      </button>
                      <button type="button" className="danger" onClick={() => removeConfig(item.id)}>
                        <FaTrashAlt aria-hidden />
                        <span>删除</span>
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
