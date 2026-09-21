/** run 元信息(run 页 Boards 信息卡/头部条数据源:GPU 卡数、created_at、heartbeat_at、config)。 */
export interface GpuInfo {
  name?: string;
  index?: number;
  vendor?: string;
}

export interface RunMetaInfo {
  run_id: string;
  state?: string;
  config?: Record<string, unknown> | null;
  env?: {
    hardware?: { gpus?: GpuInfo[] };
  } | null;
  created_at?: number;
  heartbeat_at?: number | null;
}

/** 拉 run 元信息:优先单 run 详情端点(走 require_run_read,支持匿名 share token——
 *  分享链接下 runs 列表接口 401,是成本卡恒为 0 的根因);详情不可用(旧 server 无
 *  此端点/网络异常)时回退 runs 列表查找。两路都失败返回 null,调用方保持 runInfo 缺省。 */
export async function fetchRunMeta(runId: string): Promise<RunMetaInfo | null> {
  try {
    const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (resp.ok) return (await resp.json()) as RunMetaInfo;
  } catch {
    // fall through to list fallback
  }
  try {
    const resp = await fetch('/api/v1/runs');
    if (!resp.ok) return null;
    const runs = (await resp.json()) as RunMetaInfo[];
    return runs.find((r) => r.run_id === runId) ?? null;
  } catch {
    return null;
  }
}
