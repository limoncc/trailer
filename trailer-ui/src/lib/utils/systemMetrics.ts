/**
 * 系统指标(CPU/内存/GPU)的展示层:友好名 + 单位格式化。
 *
 * 命名语法 <域>/<设备>/<资源>_<度量>[_单位],如:
 *   system/cpu_util · system/mem_used · system/nvidia/gpu0/vram_used
 * 旧版 SDK 的 key(util/mem_used_prop/power/temperature…)经 canonicalKey
 * 归一为新名,历史数据零迁移即可统一显示。
 */

/** context 是否为系统指标:system(主机) 或 system/<vendor>/<device…> */
export function isSystemContext(context: string): boolean {
  return context === 'system' || context.startsWith('system/');
}

/** 设备级 context:system 之外还有段(如 system/nvidia/gpu0);system/cpu 不算 */
export function isDeviceContext(context: string): boolean {
  return context.startsWith('system/') && context.slice('system/'.length).includes('/');
}

/** 旧版 key → 新名 */
const LEGACY_KEY: Record<string, string> = {
  cpu: 'cpu_util',
  util: 'gpu_util',
  temperature: 'temp_c',
  power: 'power_w',
  mem_used_prop: 'mem_util',
};

/** 归一为新版 key。设备 context 下的 mem_used 是显存(主机 context 是内存) */
export function canonicalKey(key: string, context: string): string {
  if (isDeviceContext(context)) {
    if (key === 'mem_used') return 'vram_used';
    if (key === 'mem_used_prop') return 'vram_util';
  }
  return LEGACY_KEY[key] ?? key;
}

const FRIENDLY: Record<string, string> = {
  cpu_util: 'CPU util',
  mem_used: 'Host memory',
  mem_util: 'Host mem util',
  gpu_util: 'GPU util',
  vram_used: 'VRAM used',
  vram_util: 'VRAM util',
  power_w: 'Power',
  temp_c: 'Temp',
};

/** 设备标签:system → host;system/nvidia/gpu0 → nvidia gpu0 */
export function deviceLabel(context: string): string {
  if (context === 'system') return 'host';
  return context.replace(/^system\//, '').replaceAll('/', ' ');
}

/** 系统指标完整显示名:"VRAM used · nvidia gpu0";非系统指标返回 null */
export function displayMetricName(key: string, context: string): string | null {
  if (!isSystemContext(context)) return null;
  const c = canonicalKey(key, context);
  if (context === 'system/cpu') {
    if (c === 'temp_c') return 'CPU temp';
    if (c === 'power_w') return 'CPU power';
  }
  const friendly = FRIENDLY[c];
  if (!friendly) return null;
  return context === 'system' ? friendly : `${friendly} · ${deviceLabel(context)}`;
}

/** 值格式化:MiB→GB、0-1→百分比、W、°C */
export function formatSystemValue(key: string, context: string, v: number): string {
  const c = canonicalKey(key, context);
  if (c === 'vram_used' || c === 'mem_used') return `${(v / 1024).toFixed(1)} GB`;
  if (c.endsWith('_util')) return `${Math.round(v * 100)}%`;
  if (c === 'power_w') return `${Math.round(v)} W`;
  if (c === 'temp_c') return `${Math.round(v)}°C`;
  return String(Math.round(v * 100) / 100);
}

/** LineChart y 轴/tooltip 刻度格式;非系统指标返回 undefined(走原逻辑) */
export function systemAxisFormatter(
  key: string,
  context: string
): ((v: number) => string) | undefined {
  if (!isSystemContext(context)) return undefined;
  return (v: number) => formatSystemValue(key, context, v);
}
