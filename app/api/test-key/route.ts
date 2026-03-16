import { NextRequest, NextResponse } from "next/server";

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";

  if (/\/v\d+$/i.test(normalized)) return `${normalized}/models`;
  if (/\/models$/i.test(normalized)) return normalized;
  return `${normalized}/v1/models`;
}

function modelExists(modelsPayload: unknown, model: string): boolean {
  if (!model) return true;
  if (!modelsPayload || typeof modelsPayload !== "object") return false;

  const data = (modelsPayload as { data?: unknown }).data;
  if (!Array.isArray(data)) return false;

  return data.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const id = (entry as { id?: unknown }).id;
    return typeof id === "string" && id === model;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };

    const baseUrl = body.baseUrl?.trim() ?? "";
    const apiKey = body.apiKey?.trim() ?? "";
    const model = body.model?.trim() ?? "";

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ ok: false, message: "地址或 Key 为空" }, { status: 400 });
    }

    const testUrl = buildModelsUrl(baseUrl);
    if (!testUrl) {
      return NextResponse.json({ ok: false, message: "地址无效" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const resp = await fetch(testUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store"
    });

    clearTimeout(timer);

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return NextResponse.json({ ok: false, message: "Key 无效或权限不足" });
      }
      if (resp.status === 404) {
        return NextResponse.json({ ok: false, message: "地址可达，但模型接口不存在" });
      }
      return NextResponse.json({ ok: false, message: `请求失败（HTTP ${resp.status}）` });
    }

    const payload = (await resp.json()) as unknown;
    if (model && !modelExists(payload, model)) {
      return NextResponse.json({ ok: false, message: `模型不存在：${model}` });
    }

    return NextResponse.json({ ok: true, message: model ? `模型可用：${model}` : "可用" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ ok: false, message: "请求超时，请检查地址" });
    }
    return NextResponse.json({ ok: false, message: "测试异常，请检查地址格式" });
  }
}
