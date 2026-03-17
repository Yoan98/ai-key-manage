"use client";

import Image from "next/image";
import OpenAI from "openai";
import { useEffect, useMemo, useState } from "react";
import {
  FaBolt,
  FaCheckCircle,
  FaCopy,
  FaEdit,
  FaFileExport,
  FaKey,
  FaLink,
  FaMagic,
  FaPaste,
  FaSave,
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
  lastTest?: {
    status: "success" | "error";
    message: string;
    detail?: string;
    testedAt: string;
  };
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
  testedAt?: string;
};
type FinishedTestResult = NonNullable<KeyConfig["lastTest"]>;

const STORAGE_KEY = "ai-key-vault-configs-v1";
const PASS_TEXT = "主人，快鞭策我吧";
const FAIL_TEXT = "主人，我不行了";

const labelClass = "mb-1.5 mt-2.5 block text-sm font-semibold text-zinc-700";
const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-emerald-100";
const btnBase =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const btnPrimary = `${btnBase} border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700`;
const btnGhost = `${btnBase} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 hover:border-zinc-400`;
const btnDanger = `${btnBase} border-red-200 bg-white text-red-600 hover:border-red-700 hover:bg-red-700 hover:text-white`;
const topBtnBase =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const topBtnPrimary = `${topBtnBase} border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700`;
const topBtnGhost = `${topBtnBase} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 hover:border-zinc-400`;
const topBtnDanger = `${topBtnBase} border-red-200 bg-white text-red-500 hover:border-red-700 hover:bg-red-700 hover:text-white`;
const smallBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50";
const smallDangerBtn =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-700 hover:bg-red-700 hover:text-white";
const iconCopyBtn =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45";

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function toOpenAIBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return "";

  const withoutEndpoint = normalized
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/completions$/i, "");

  if (/\/v\d+$/i.test(withoutEndpoint)) return withoutEndpoint;
  return `${withoutEndpoint}/v1`;
}

function cleanKey(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").trim();
}

function toMaskedKey(key: string): string {
  if (key.length <= 10) return "******";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function makeDefaultName(index: number): string {
  return `配置${index}`;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function collectGlobalMatches(text: string, regex: RegExp, group = 0): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(regex)) {
    const value = (match[group] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function parseSingleSegment(input: string): Partial<FormState> {
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
      out.apiKey = cleanKey(m[1]);
      break;
    }
  }
  if (!out.apiKey) {
    const fallback = text.match(/(?:sk|rk|ak|pk)[-_][A-Za-z0-9._-]{8,}/i);
    if (fallback?.[0]) out.apiKey = cleanKey(fallback[0]);
  }

  const urlMatch = text.match(/https?:\/\/[^\s"'`]+/i);
  if (urlMatch?.[0]) {
    out.baseUrl = normalizeBaseUrl(urlMatch[0]);
  } else {
    const hostLike = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'`]*)?/i);
    if (hostLike?.[0]) out.baseUrl = normalizeBaseUrl(hostLike[0]);
  }

  const modelMatch = text.match(/(?:model|model_name)["'\s:=]+([A-Za-z0-9._:-]{2,})/i);
  if (modelMatch?.[1]) out.model = modelMatch[1].trim();

  return out;
}

function parseObjectConfig(item: unknown): Partial<FormState> {
  if (!item || typeof item !== "object") return {};

  const obj = item as Record<string, unknown>;
  const rawBaseUrl =
    obj.baseUrl ?? obj.base_url ?? obj.url ?? obj.endpoint ?? obj.host ?? obj.apiBase ?? obj.api_base;
  const rawApiKey =
    obj.apiKey ??
    obj.api_key ??
    obj.key ??
    obj.token ??
    obj.access_token ??
    obj.authorization ??
    obj.auth;
  const rawModel = obj.model ?? obj.model_name ?? obj.modelName;

  return {
    name: "",
    baseUrl: rawBaseUrl ? normalizeBaseUrl(String(rawBaseUrl)) : "",
    apiKey: rawApiKey ? cleanKey(String(rawApiKey)) : "",
    model: rawModel ? String(rawModel).trim() : ""
  };
}

function finalizeParsed(items: Partial<FormState>[], startIndex: number): FormState[] {
  const cleaned = items
    .map((item) => ({
      name: (item.name || "").trim(),
      baseUrl: normalizeBaseUrl(item.baseUrl || ""),
      apiKey: cleanKey(item.apiKey || ""),
      model: (item.model || "").trim()
    }))
    .filter((item) => item.baseUrl || item.apiKey || item.model);

  const deduped: FormState[] = [];
  const seen = new Set<string>();

  for (const item of cleaned) {
    const key = `${item.baseUrl}__${item.apiKey}__${item.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.map((item, index) => ({
    ...item,
    name: makeDefaultName(startIndex + index)
  }));
}

function parsePastedConfigs(input: string, startIndex: number): FormState[] {
  const text = input.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as unknown;
    let source: unknown[] = [];

    if (Array.isArray(parsed)) {
      source = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.configs)) source = obj.configs;
      else if (Array.isArray(obj.items)) source = obj.items;
      else source = [obj];
    }

    const fromJson = finalizeParsed(source.map(parseObjectConfig), startIndex);
    if (fromJson.length > 0) return fromJson;
  } catch {
    // Ignore JSON parse errors and continue with text parsing.
  }

  const blocks = text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    const fromBlocks = finalizeParsed(blocks.map(parseSingleSegment), startIndex);
    if (fromBlocks.length > 0) return fromBlocks;
  }

  const globalUrls = collectGlobalMatches(text, /https?:\/\/[^\s"'`]+/gi).map(normalizeBaseUrl);
  const globalKeys = [
    ...collectGlobalMatches(text, /api[_-]?key["'\s:=]+([A-Za-z0-9._-]{10,})/gi, 1),
    ...collectGlobalMatches(text, /bearer\s+([A-Za-z0-9._-]{10,})/gi, 1),
    ...collectGlobalMatches(text, /(?:sk|rk|ak|pk)[-_][A-Za-z0-9._-]{8,}/gi)
  ].map(cleanKey);
  const globalModels = [
    ...collectGlobalMatches(text, /(?:model|model_name)["'\s:=]+([A-Za-z0-9._:-]{2,})/gi, 1),
    ...collectGlobalMatches(text, /"model"\s*:\s*"([^"]+)"/gi, 1)
  ];

  const paired: Partial<FormState>[] = [];
  const pairCount = Math.max(globalUrls.length, globalKeys.length, globalModels.length);
  for (let i = 0; i < pairCount; i += 1) {
    const baseUrl = globalUrls[i] || globalUrls[0] || "";
    const apiKey = globalKeys[i] || globalKeys[0] || "";
    const model = globalModels[i] || globalModels[0] || "";
    if (baseUrl || apiKey || model) paired.push({ baseUrl, apiKey, model });
  }

  const fromGlobal = finalizeParsed(paired, startIndex);
  if (fromGlobal.length > 0) return fromGlobal;

  const single = finalizeParsed([parseSingleSegment(text)], startIndex);
  return single;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanOneLineText(input: string, maxLen = 220): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen)}...`;
}

function toReadableResponseText(content: unknown): string {
  if (typeof content === "string") return cleanOneLineText(content);
  if (!Array.isArray(content)) return "";

  const texts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      const text = part.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean);

  return cleanOneLineText(texts.join(" "));
}

function safeDateToIso(input: unknown): string {
  if (typeof input !== "string") return "";
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function normalizeFinishedTestResult(input: unknown): FinishedTestResult | undefined {
  if (!isRecord(input)) return undefined;

  const status = input.status;
  if (status !== "success" && status !== "error") return undefined;

  const message = typeof input.message === "string" && input.message.trim() ? input.message.trim() : "";
  const detail = typeof input.detail === "string" && input.detail.trim() ? cleanOneLineText(input.detail, 300) : "";
  const testedAt = safeDateToIso(input.testedAt);

  if (!testedAt) return undefined;

  return {
    status,
    message: message || (status === "success" ? PASS_TEXT : FAIL_TEXT),
    detail: detail || undefined,
    testedAt
  };
}

function toDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}

function getErrorMessage(error: unknown): string {
  if (!isRecord(error)) return "";

  const directMessage = error.message;
  if (typeof directMessage === "string" && directMessage.trim()) return cleanOneLineText(directMessage, 260);

  const nestedPaths = [
    ["error", "message"],
    ["response", "error", "message"],
    ["body", "error", "message"],
    ["cause", "message"]
  ];

  for (const path of nestedPaths) {
    let current: unknown = error;
    for (const key of path) {
      if (!isRecord(current)) {
        current = "";
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" && current.trim()) return cleanOneLineText(current, 260);
  }

  return "";
}

function makeErrorDetail(error: unknown): string {
  const baseError = isRecord(error) ? error : {};
  const status = typeof baseError.status === "number" ? baseError.status : undefined;
  const name = typeof baseError.name === "string" ? baseError.name : "";
  const raw = getErrorMessage(error);

  let detail = "测试异常，请检查地址或模型";
  if (status === 401 || status === 403) detail = "Key 无效或权限不足";
  else if (status === 404) detail = "地址可达，但聊天接口不存在";
  else if (typeof status === "number") detail = `请求失败（HTTP ${status}）`;
  else if (name === "AbortError" || /timeout|timed out/i.test(raw)) detail = "请求超时，请检查地址";
  else if (/network|fetch failed|connection|ENOTFOUND|ECONNREFUSED/i.test(raw))
    detail = "请求失败，请检查网络或地址";

  if (!raw) return detail;
  if (detail.includes(raw)) return detail;
  return `${detail}；接口返回：${raw}`;
}

function normalizeStoredConfigs(raw: string): KeyConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const normalized: KeyConfig[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isRecord(item)) continue;

    const id = typeof item.id === "string" && item.id ? item.id : crypto.randomUUID();
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : makeDefaultName(index + 1);
    const baseUrl = normalizeBaseUrl(typeof item.baseUrl === "string" ? item.baseUrl : "");
    const apiKey = cleanKey(typeof item.apiKey === "string" ? item.apiKey : "");
    const model = typeof item.model === "string" ? item.model.trim() : "";
    const createdAt = safeDateToIso(item.createdAt) || new Date().toISOString();
    const lastTest = normalizeFinishedTestResult(item.lastTest);

    normalized.push({ id, name, baseUrl, apiKey, model, createdAt, lastTest });
  }

  return normalized;
}

function defaultTestResult(): TestResult {
  return { status: "idle", message: "未测试" };
}

function statusPillClass(status: TestStatus): string {
  if (status === "success") return "bg-emerald-50 text-emerald-800";
  if (status === "error") return "bg-red-50 text-red-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function StatusIcon({ status }: { status: TestStatus }) {
  if (status === "success") return <FaCheckCircle aria-hidden />;
  if (status === "error") return <FaTimesCircle aria-hidden />;
  if (status === "pending") return <FaSpinner className="animate-spin" aria-hidden />;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>({ name: "", baseUrl: "", apiKey: "", model: "" });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      setConfigs(normalizeStoredConfigs(raw));
    } catch {
      setConfigs([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }, [configs]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const nextIndex = useMemo(() => configs.length + 1, [configs.length]);

  function ExportMenu({
    onExport,
    label = "导出",
    size = "default",
    triggerClassName
  }: {
    onExport: (type: ExportType) => void;
    label?: string;
    size?: "default" | "small";
    triggerClassName?: string;
  }) {
    const menuItemClass =
      "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100";
    const triggerClass =
      triggerClassName || (size === "small" ? `${smallBtn} list-none` : `${btnGhost} list-none`);

    function handle(type: ExportType, e: React.MouseEvent<HTMLButtonElement>) {
      onExport(type);
      const details = e.currentTarget.closest("details") as HTMLDetailsElement | null;
      if (details) details.open = false;
    }

    return (
      <details className="relative">
        <summary
          className={`${triggerClass} cursor-pointer [&::-webkit-details-marker]:hidden`}
          title={label}
          aria-label={label}
        >
          <FaFileExport aria-hidden />
          <span>{label}</span>
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
          <button type="button" className={menuItemClass} onClick={(e) => handle("md", e)}>
            导出 .md
          </button>
          <button type="button" className={menuItemClass} onClick={(e) => handle("txt", e)}>
            导出 .txt
          </button>
        </div>
      </details>
    );
  }

  function applyPaste() {
    const parsed = parsePastedConfigs(pasteRaw, nextIndex);
    if (parsed.length === 0) {
      setNotice("未识别到完整配置");
      return;
    }

    setForm(parsed[0]);
    if (parsed.length > 1) {
      setNotice(`已识别 ${parsed.length} 个配置，点击“粘贴并直接新增”可一次导入`);
    } else {
      setNotice("已解析到表单");
    }
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
    const parsed = parsePastedConfigs(pasteRaw, nextIndex);
    if (parsed.length === 0) {
      setNotice("未识别到可插入字段");
      return;
    }

    const newItems: KeyConfig[] = parsed.map((item) => ({
      id: crypto.randomUUID(),
      name: item.name,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      model: item.model,
      createdAt: new Date().toISOString()
    }));

    setConfigs((prev) => [...newItems, ...prev]);
    setForm({ name: "", baseUrl: "", apiKey: "", model: "" });
    setPasteRaw("");
    setNotice(`已新增 ${newItems.length} 个配置`);
  }

  function addConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const baseUrl = normalizeBaseUrl(form.baseUrl);
    const apiKey = cleanKey(form.apiKey);
    const model = form.model.trim();
    let name = form.name.trim();

    if (!baseUrl && !apiKey && !model) {
      setNotice("请至少填写地址、Key、模型中的一个");
      return;
    }
    if (!name) name = makeDefaultName(nextIndex);

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
    if (editingModelId === id) {
      setEditingModelId(null);
      setModelDraft("");
    }
    setNotice("已删除");
  }

  function removeAllConfigs() {
    if (configs.length === 0) {
      setNotice("暂无配置可删除");
      return;
    }

    const confirmed = window.confirm(`确认删除全部 ${configs.length} 条配置吗？此操作不可恢复。`);
    if (!confirmed) return;

    setConfigs([]);
    setResultMap({});
    setLoadingMap({});
    setEditingId(null);
    setEditingModelId(null);
    setModelDraft("");
    setNotice("已删除全部配置");
  }

  function commitFinishedTestResult(id: string, result: FinishedTestResult) {
    setResultMap((prev) => ({ ...prev, [id]: result }));
    setConfigs((prev) => prev.map((item) => (item.id === id ? { ...item, lastTest: result } : item)));
  }

  async function runTest(item: KeyConfig): Promise<boolean> {
    setLoadingMap((prev) => ({ ...prev, [item.id]: true }));
    setResultMap((prev) => ({ ...prev, [item.id]: { status: "pending", message: "测试中..." } }));

    const baseUrl = toOpenAIBaseUrl(item.baseUrl);
    const apiKey = cleanKey(item.apiKey);

    if (!baseUrl || !apiKey) {
      commitFinishedTestResult(item.id, {
        status: "error",
        message: FAIL_TEXT,
        detail: "地址或 Key 为空",
        testedAt: new Date().toISOString()
      });
      setLoadingMap((prev) => ({ ...prev, [item.id]: false }));
      return false;
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: baseUrl,
        timeout: 12000,
        maxRetries: 0,
        dangerouslyAllowBrowser: true
      });

      const response = await client.chat.completions.create({
        model: item.model || "gpt-4o-mini",
        messages: [{ role: "user", content: "你好，请回复：ok" }],
        max_tokens: 16
      });

      const content = response.choices[0]?.message?.content;
      const readableText = toReadableResponseText(content);
      const hasMessage = Boolean(readableText || content);

      if (hasMessage) {
        commitFinishedTestResult(item.id, {
          status: "success",
          message: PASS_TEXT,
          detail: readableText ? `接口返回：${readableText}` : "返回消息正常",
          testedAt: new Date().toISOString()
        });
        return true;
      }

      commitFinishedTestResult(item.id, {
        status: "error",
        message: FAIL_TEXT,
        detail: "未返回消息内容",
        testedAt: new Date().toISOString()
      });
      return false;
    } catch (error: unknown) {
      commitFinishedTestResult(item.id, {
        status: "error",
        message: FAIL_TEXT,
        detail: makeErrorDetail(error),
        testedAt: new Date().toISOString()
      });
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

  function exportOne(item: KeyConfig, type: ExportType) {
    const filename = `${sanitizeFilename(item.name || "ai-key")}.${type}`;
    const content = formatConfig(item, type);
    downloadText(filename, content);
  }

  function exportAll(type: ExportType) {
    const content = formatAll(configs, type);
    const filename = `ai-key-configs.${type}`;
    downloadText(filename, content);
  }

  function startEdit(item: KeyConfig) {
    setEditingId(item.id);
    setEditForm({ name: item.name, baseUrl: item.baseUrl, apiKey: item.apiKey, model: item.model });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ name: "", baseUrl: "", apiKey: "", model: "" });
  }

  function saveEdit(id: string) {
    const baseUrl = normalizeBaseUrl(editForm.baseUrl);
    const apiKey = cleanKey(editForm.apiKey);
    const name = editForm.name.trim();
    const model = editForm.model.trim();

    if (!baseUrl || !apiKey) {
      setNotice("编辑保存失败：地址和 Key 不能为空");
      return;
    }

    const original = configs.find((item) => item.id === id);
    const resetLastTest = original
      ? original.baseUrl !== baseUrl || original.apiKey !== apiKey || (original.model || "") !== model
      : false;

    setConfigs((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, name: name || item.name, baseUrl, apiKey, model, lastTest: resetLastTest ? undefined : item.lastTest }
          : item
      )
    );
    if (resetLastTest) {
      setResultMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    if (editingModelId === id) {
      setEditingModelId(null);
      setModelDraft("");
    }

    cancelEdit();
    setNotice("已保存编辑");
  }

  function startInlineModelEdit(item: KeyConfig) {
    setEditingModelId(item.id);
    setModelDraft(item.model || "");
  }

  function saveInlineModelEdit(id: string) {
    const nextModel = modelDraft.trim();
    const original = configs.find((item) => item.id === id);
    const resetLastTest = original ? (original.model || "") !== nextModel : false;

    setConfigs((prev) =>
      prev.map((item) => (item.id === id ? { ...item, model: nextModel, lastTest: resetLastTest ? undefined : item.lastTest } : item))
    );
    if (resetLastTest) {
      setResultMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    setEditingModelId(null);
    setModelDraft("");
    setNotice("模型已更新");
  }

  function cancelInlineModelEdit() {
    setEditingModelId(null);
    setModelDraft("");
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-3 px-3 py-4 text-zinc-900 sm:px-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          <Image
            src="/logo.png"
            alt="Logo"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg object-cover ring-1 ring-emerald-200 sm:h-9 sm:w-9"
            priority
          />
          <span>AI Key Vault</span>
        </h1>
        <p className="text-sm text-zinc-500">本地保存、批量测试、复制与导出</p>
      </header>

      <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50/70 to-white p-3.5 shadow-sm">
        <p className="text-base font-extrabold text-emerald-900 sm:text-lg">这是你的 AI API Key 本地保险箱</p>
        <p className="mt-1.5 text-sm leading-6 text-emerald-800">
          统一管理名称/地址/Key/模型，支持一键测全部和单条测试，数据仅存浏览器本地。
        </p>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">新增配置</h2>
            <span className="text-xs text-zinc-500">{configs.length} 条配置</span>
          </div>

          <label className={labelClass}>粘贴内容（支持一次解析多个配置）</label>
          <textarea
            className={inputClass}
            value={pasteRaw}
            onChange={(e) => setPasteRaw(e.target.value)}
            placeholder="可粘贴 curl、JSON、环境变量、多个配置块"
            rows={3}
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={applyPaste}>
              <FaMagic aria-hidden />
              <span>解析到表单</span>
            </button>
            <button type="button" className={btnPrimary} onClick={addFromPaste}>
              <FaPaste aria-hidden />
              <span>粘贴并直接新增</span>
            </button>
          </div>

          <form onSubmit={addConfig} className="mt-2">
            <label className={labelClass}>名称</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={`例如：${makeDefaultName(nextIndex)}`}
            />

            <label className={labelClass}>地址</label>
            <input
              className={inputClass}
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="例如：https://api.openai.com/v1"
              required
            />

            <label className={labelClass}>Key</label>
            <input
              className={inputClass}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="例如：sk-xxxx"
              required
            />

            <label className={labelClass}>模型（可选）</label>
            <input
              className={inputClass}
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="例如：gpt-4.1-mini"
            />

            <div className="mt-2 flex flex-wrap gap-2">
              <button type="submit" className={btnPrimary}>
                <FaSave aria-hidden />
                <span>保存配置</span>
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="mb-3 space-y-2">
            <h2 className="text-base font-semibold whitespace-nowrap text-zinc-900">配置列表</h2>
            <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button type="button" className={topBtnPrimary} onClick={testAllConfigs} disabled={testingAll}>
                {testingAll ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                <span>{testingAll ? "测试中" : "一键测试全部"}</span>
              </button>
              <button
                type="button"
                className={topBtnGhost}
                onClick={() => copyText(formatAll(configs, "txt"), "已复制全部配置")}
              >
                <FaCopy aria-hidden />
                <span>复制全部</span>
              </button>
              <ExportMenu onExport={exportAll} triggerClassName={topBtnGhost} />
              <button
                type="button"
                className={topBtnDanger}
                onClick={removeAllConfigs}
                disabled={configs.length === 0}
              >
                <FaTrashAlt aria-hidden />
                <span>一键删除</span>
              </button>
            </div>
          </div>

          {notice ? (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {notice}
            </div>
          ) : null}

          {configs.length === 0 ? (
            <p className="text-sm text-zinc-500">暂无配置</p>
          ) : (
            <ul className="grid gap-3">
              {configs.map((item) => {
                const testing = loadingMap[item.id];
                const result = resultMap[item.id] || item.lastTest || defaultTestResult();
                const isEditing = editingId === item.id;
                const isEditingModel = editingModelId === item.id;

                return (
                  <li key={item.id} className="rounded-2xl border border-zinc-200 bg-white p-3">
                    {isEditing ? (
                      <div className="rounded-xl border border-dashed border-zinc-300 p-3">
                        <label className={labelClass}>名称</label>
                        <input
                          className={inputClass}
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        />

                        <label className={labelClass}>地址</label>
                        <input
                          className={inputClass}
                          value={editForm.baseUrl}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                        />

                        <label className={labelClass}>Key</label>
                        <input
                          className={inputClass}
                          value={editForm.apiKey}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                        />

                        <label className={labelClass}>模型</label>
                        <input
                          className={inputClass}
                          value={editForm.model}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, model: e.target.value }))}
                        />

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className={btnPrimary} onClick={() => saveEdit(item.id)}>
                            <FaSave aria-hidden />
                            <span>保存编辑</span>
                          </button>
                          <button type="button" className={btnGhost} onClick={cancelEdit}>
                            <FaTimesCircle aria-hidden />
                            <span>取消</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-base font-bold text-zinc-900">{item.name}</div>

                        <div className="mt-2 grid gap-2">
                          <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                              <FaLink aria-hidden /> 地址
                            </span>
                            <div className="inline-flex max-w-full items-start gap-1.5">
                              <span className="min-w-0 break-all text-sm text-zinc-800">{item.baseUrl || "(未填写)"}</span>
                              <button
                                type="button"
                                className={iconCopyBtn}
                                onClick={() => copyText(item.baseUrl, `已复制地址：${item.name}`)}
                                title="复制地址"
                                aria-label="复制地址"
                                disabled={!item.baseUrl}
                              >
                                <FaCopy aria-hidden />
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                              <FaKey aria-hidden /> Key
                            </span>
                            <div className="inline-flex max-w-full items-start gap-1.5">
                              <span className="min-w-0 break-all font-mono text-sm text-zinc-800">
                                {item.apiKey ? toMaskedKey(item.apiKey) : "(未填写)"}
                              </span>
                              <button
                                type="button"
                                className={iconCopyBtn}
                                onClick={() => copyText(item.apiKey, `已复制 Key：${item.name}`)}
                                title="复制 Key"
                                aria-label="复制 Key"
                                disabled={!item.apiKey}
                              >
                                <FaCopy aria-hidden />
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                              <FaTag aria-hidden /> 模型
                            </span>
                            {isEditingModel ? (
                              <input
                                autoFocus
                                className={inputClass}
                                value={modelDraft}
                                onChange={(e) => setModelDraft(e.target.value)}
                                onBlur={() => saveInlineModelEdit(item.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    saveInlineModelEdit(item.id);
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelInlineModelEdit();
                                  }
                                }}
                                placeholder="点击后可修改"
                              />
                            ) : (
                              <button
                                type="button"
                                className="inline-flex w-fit rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
                                onClick={() => startInlineModelEdit(item)}
                                title="点击编辑模型"
                                aria-label="点击编辑模型"
                              >
                                {item.model || "点击设置模型"}
                              </button>
                            )}
                          </div>

                          <div className="grid gap-1 sm:grid-cols-[90px_1fr] sm:items-start sm:gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                              <FaVial aria-hidden /> 状态
                            </span>
                            <div className="grid gap-1">
                              <span
                                className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusPillClass(result.status)}`}
                              >
                                <StatusIcon status={result.status} />
                                <span>{result.message}</span>
                              </span>
                              {result.status === "error" && result.detail ? (
                                <details className="w-full rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-xs text-red-800">
                                  <summary className="cursor-pointer font-medium text-red-700">有错误，点击查看详情</summary>
                                  <div className="mt-1 whitespace-pre-wrap break-words leading-5">{result.detail}</div>
                                </details>
                              ) : result.detail ? (
                                <span className="text-xs text-zinc-500">{result.detail}</span>
                              ) : null}
                              {item.lastTest?.testedAt ? (
                                <span className="text-xs text-zinc-500">
                                  上次测试：{toDateTimeLabel(item.lastTest.testedAt)}（
                                  {item.lastTest.status === "success" ? "通过" : "失败"}）
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-200 pt-2">
                          <button
                            type="button"
                            className={smallBtn}
                            onClick={() => testConfig(item)}
                            disabled={testing}
                            title="测试"
                            aria-label="测试"
                          >
                            {testing ? <FaSpinner className="animate-spin" aria-hidden /> : <FaBolt aria-hidden />}
                            <span>测试</span>
                          </button>
                          <button
                            type="button"
                            className={smallBtn}
                            onClick={() => copyText(formatConfig(item, "txt"), `已复制：${item.name}`)}
                            title="复制"
                            aria-label="复制"
                          >
                            <FaCopy aria-hidden />
                            <span>复制</span>
                          </button>
                          <ExportMenu onExport={(type) => exportOne(item, type)} label="导出" size="small" />
                          <button
                            type="button"
                            className={smallBtn}
                            onClick={() => startEdit(item)}
                            title="编辑"
                            aria-label="编辑"
                          >
                            <FaEdit aria-hidden />
                            <span>编辑</span>
                          </button>
                          <button
                            type="button"
                            className={smallDangerBtn}
                            onClick={() => removeConfig(item.id)}
                            title="删除"
                            aria-label="删除"
                          >
                            <FaTrashAlt aria-hidden />
                            <span>删除</span>
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
