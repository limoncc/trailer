<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import '../app.css';
  import Button from '$lib/components/ui/Button.svelte';
  import { api } from '$lib/utils/api';
  import { applyCustomTheme, loadCustomTheme, saveCustomTheme, loadThemeState, applyThemeState } from '$lib/theme-builder/color';
  import { FlaskConical, FileText, Microscope, Moon, Sun, Trash2, Zap, Leaf, BookOpen, Eclipse } from 'lucide-svelte';
  import { initAuthFetch } from '$lib/utils/authFetch';
  import { createAuthReadyPromise, signalAuthReady, authReady } from '$lib/utils/auth';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { getProjects, getOwners, getUser, setProjects, setOwners, setUser } from '$lib/projectsStore.svelte';

  let { children } = $props();

  // 尽早 patch 全局 fetch 注入 Bearer token —— 刷新页面时子组件 onMount 的请求
  // 会先于父组件 $effect 执行,若不提前 patch 会因无 token 而 401
  if (browser) initAuthFetch();

  let projects = $derived(getProjects());
  let owners = $derived(getOwners());
  let user = $derived(getUser());
  // PROJECTS 侧边栏:搜索 + 分页
  const PROJECTS_PER_PAGE = 20;
  let projectSearch = $state('');
  let projectPage = $state(1);
  const filteredProjects = $derived(
    projects.filter((p) => p.toLowerCase().includes(projectSearch.trim().toLowerCase())),
  );
  const projectTotalPages = $derived(Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE)));
  const pagedProjects = $derived(
    filteredProjects.slice((projectPage - 1) * PROJECTS_PER_PAGE, projectPage * PROJECTS_PER_PAGE),
  );
  function onProjectSearch(e: Event) {
    projectSearch = (e.currentTarget as HTMLInputElement).value;
    projectPage = 1;
  }
  const THEMES = ['light', 'dark', 'cyber', 'nature', 'editorial', 'midnight'] as const;
  let theme = $state<string>(typeof localStorage !== 'undefined' ? localStorage.getItem('trailer_theme') || 'light' : 'light');

  function isDarkTheme(name: string): boolean {
    return name === 'dark' || name === 'cyber' || name === 'midnight';
  }

  function clearInlineTheme() {
    const el = document.documentElement;
    for (const k of [...['background','foreground','card','card-foreground','popover','popover-foreground','primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground','accent','accent-foreground','destructive','border','input','ring','radius']]) {
      el.style.removeProperty(`--${k}`);
    }
  }

  /** 把主题偏好应用到 <html>:custom → 内联变量;预置 → data-theme */
  function applyThemePreference(t: { name: string; isDark?: boolean; vars?: Record<string, string> }) {
    theme = t.name;
    localStorage.setItem('trailer_theme', t.name);
    clearInlineTheme();
    if (t.name === 'custom' && t.vars) {
      applyCustomTheme({ vars: t.vars, isDark: !!t.isDark });
    } else {
      document.documentElement.setAttribute('data-theme', t.name);
      document.documentElement.classList.toggle('dark', t.isDark ?? isDarkTheme(t.name));
    }
  }

  /** 持久化当前主题到后端(按用户,跨设备保持) */
  async function persistTheme(name: string, isDark: boolean, vars?: Record<string, string>) {
    try {
      await api('/api/v1/users/me/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: JSON.stringify({ name, isDark, vars }) }),
      });
    } catch { /* 未登录/失败忽略 */ }
  }

  /** 登录后拉取用户后端主题并应用 */
  async function loadUserTheme() {
    await authReady();
    try {
      const resp = await api('/api/v1/users/me/theme');
      if (!resp.ok) return;
      const data = await resp.json();
      const t = JSON.parse(data.theme || '{}');
      if (t && t.name) applyThemePreference(t);
    } catch { /* ignore */ }
  }

  function cycleTheme() {
    const idx = THEMES.indexOf(theme as any);
    if (idx === -1) { applyThemePreference({ name: 'light', isDark: false }); return; }
    const next = THEMES[(idx + 1) % THEMES.length];
    const isDark = isDarkTheme(next);
    applyThemePreference({ name: next, isDark });
    persistTheme(next, isDark);
  }

  // Apply on init (localStorage for fast paint, then backend per-user theme)
  $effect(() => {
    const stored = localStorage.getItem('trailer_theme') || 'light';
    theme = stored;
    if (stored === 'custom') {
      // 优先恢复完整 ThemeState(含预设名/字体/chart/menu),旧数据回退到 CustomTheme
      const ts = loadThemeState();
      if (ts) { applyThemeState(ts); return; }
      const ct = loadCustomTheme();
      if (ct) { applyCustomTheme(ct); return; }
      theme = 'light';
    }
    document.documentElement.setAttribute('data-theme', stored);
    document.documentElement.classList.toggle('dark', stored === 'dark' || stored === 'cyber' || stored === 'midnight');
  });

  onMount(() => { loadUserTheme(); });
  let sidebarWidth = $state(224);
  let dragging = $state(false);
  let confirmDelete = $state<string | null>(null);
  let deleteError = $state('');

  /** 当前用户对该项目是否有管理权(admin 或项目 owner)。 */
  function canManage(project: string): boolean {
    return user?.role === 'admin' || owners.get(project) === user?.id;
  }

  async function deleteProject() {
    const name = confirmDelete;
    if (!name) return;
    try {
      const resp = await fetch(`/api/v1/projects/${encodeURIComponent(name)}/delete`, { method: 'POST' });
      if (resp.ok) {
        confirmDelete = null;
        deleteError = '';
        await loadProjects();
      } else {
        const err = await resp.json();
        deleteError = err.error || 'Failed to delete project';
      }
    } catch {
      deleteError = 'Network error';
    }
  }

  function loadUser() {
    const stored = localStorage.getItem('trailer_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); signalAuthReady(); return; } catch {}
    }
    // Skip if user explicitly signed out
    if (localStorage.getItem('trailer_signed_out')) { signalAuthReady(); return; }
    // Auto-login with default admin credentials (local mode)
    fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d) {
        localStorage.setItem('trailer_token', d.token);
        localStorage.setItem('trailer_user', JSON.stringify(d.user));
        localStorage.removeItem('trailer_signed_out');
        setUser(d.user);
      }
      signalAuthReady();
    }).catch(() => { signalAuthReady(); });
  }

  function logout() {
    localStorage.removeItem('trailer_token');
    localStorage.removeItem('trailer_user');
    localStorage.setItem('trailer_signed_out', '1');
    setUser(null);
    window.location.href = '/login';
  }

  async function loadProjects() {
    try {
      const resp = await fetch('/api/v1/runs?limit=1000');
      if (resp.ok) {
        const runs = await resp.json();
        const projSet = new Set<string>();
        const ownersMap = new Map<string, number | null>();
        for (const r of runs) {
          projSet.add(r.project);
          if (!ownersMap.has(r.project)) ownersMap.set(r.project, r.owner_id ?? null);
        }
        setProjects([...projSet]);
        setOwners(ownersMap);
      }
    } catch (_) {}
  }

  function restoreWidth() {
    try {
      const saved = localStorage.getItem('trailer-sidebar-width');
      if (saved) sidebarWidth = parseInt(saved, 10);
    } catch { /* ignore */ }
  }

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const handle = e.currentTarget as HTMLElement;

    function onMove(ev: MouseEvent) {
      const w = Math.max(160, Math.min(500, startW + (ev.clientX - startX)));
      sidebarWidth = w;
    }

    function onUp() {
      dragging = false;
      try { localStorage.setItem('trailer-sidebar-width', String(sidebarWidth)); } catch {}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }

    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  $effect(() => { createAuthReadyPromise(); loadUser(); });
  $effect(() => { authReady().then(() => loadProjects()); });
  $effect(() => { restoreWidth(); });
</script>

<svelte:head>
  <title>Trailer</title>
</svelte:head>

<div class="flex h-screen bg-background">
  <aside
    class="border-r border-border bg-card flex flex-col shrink-0 overflow-hidden"
    style="width: {sidebarWidth}px"
  >
    <div class="p-4 border-b border-border flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold flex items-center gap-2"><Microscope class="size-5" /><a href="/" class="hover:text-primary">Trailer</a></h1>
        <p class="text-xs text-muted-foreground">Experiment Tracking</p>
      </div>
      <Button variant="ghost" size="icon" onclick={cycleTheme} title={theme}>
        {#if theme === 'light'}<Sun class="size-4" />
        {:else if theme === 'dark'}<Moon class="size-4" />
        {:else if theme === 'cyber'}<Zap class="size-4" />
        {:else if theme === 'nature'}<Leaf class="size-4" />
        {:else if theme === 'editorial'}<BookOpen class="size-4" />
        {:else if theme === 'midnight'}<Eclipse class="size-4" />
        {/if}
      </Button>
    </div>

    <nav class="flex-1 overflow-y-auto p-2 flex flex-col">
      <div class="text-xs font-semibold text-muted-foreground uppercase px-2 py-1">Projects</div>
      {#if projects.length > 0}
        <div class="px-2 pb-1">
          <input
            type="text"
            placeholder="Search projects..."
            value={projectSearch}
            oninput={onProjectSearch}
            class="w-full px-2 py-1 text-xs border border-border rounded-md bg-background"
          />
        </div>
        <div class="space-y-0.5">
          {#each pagedProjects as p}
            <div class="flex items-center gap-0 group">
              <a href="/?project={p}"
                 class="flex-1 block px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 truncate">
                <FlaskConical class="size-3.5 inline-block mr-1.5" />{p}
              </a>
              {#if canManage(p)}
              <button
                onclick={() => { confirmDelete = p; deleteError = ''; }}
                class="p-1.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                title="Delete project"
              >
                <Trash2 class="size-3" />
              </button>
              {/if}
            </div>
          {:else}
            <p class="text-xs text-muted-foreground px-2 py-2">No projects found</p>
          {/each}
        </div>
        {#if projectTotalPages > 1}
          <div class="flex items-center justify-between px-2 pt-2 text-[11px]">
            <button
              onclick={() => (projectPage = Math.max(1, projectPage - 1))}
              disabled={projectPage <= 1}
              class="px-1.5 py-0.5 border border-border rounded-md hover:bg-accent/50 disabled:opacity-40 disabled:hover:bg-transparent"
            >← Prev</button>
            <span class="text-muted-foreground">{projectPage} / {projectTotalPages}</span>
            <button
              onclick={() => (projectPage = Math.min(projectTotalPages, projectPage + 1))}
              disabled={projectPage >= projectTotalPages}
              class="px-1.5 py-0.5 border border-border rounded-md hover:bg-accent/50 disabled:opacity-40 disabled:hover:bg-transparent"
            >Next →</button>
          </div>
        {/if}
      {:else}
        <p class="text-xs text-muted-foreground px-2 py-4">Loading projects...</p>
      {/if}

      {#if user}
        <div class="border-t border-border my-2 mx-2"></div>
        <a href="/explore"
           class="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 flex items-center gap-2">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>Explore
        </a>
        <a href="/reports"
           class="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 flex items-center gap-2">
          <FileText class="size-3.5" />Reports
        </a>
        {#if user.role === 'admin'}
          <a href="/dashboard"
             class="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 flex items-center gap-2">
            <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Dashboard
          </a>
        {/if}
        <a href="/shares"
           class="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 flex items-center gap-2">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>Shared Links
        </a>
        <a href="/theme-builder"
           class="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent/50 flex items-center gap-2">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="0.5"/><circle cx="17.5" cy="10.5" r="0.5"/><circle cx="8.5" cy="7.5" r="0.5"/><circle cx="6.5" cy="12.5" r="0.5"/><path d="M12 22a10 10 0 1 1 10-10"/></svg>Theme Builder
        </a>
      {/if}
    </nav>

      <!-- Refresh interval -->
      <div class="border-t border-border px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span class="flex items-center gap-1.5">
          <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>
          Auto-refresh
        </span>
        <select
          class="text-[10px] bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
          bind:value={$refreshInterval}
        >
          <option value={0}>Off</option>
          <option value={5}>5s</option>
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
        </select>
      </div>

      <!-- User section at bottom -->
      <div class="border-t border-border px-2 py-2 flex items-center gap-2 text-xs">
        {#if user}
          <a href="/profile" class="flex items-center gap-2 flex-1 hover:bg-accent/50 rounded-md px-2 py-1.5 transition-colors no-underline">
            <span class="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
              {user.username[0].toUpperCase()}
            </span>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-foreground truncate">{user.username}</div>
              <div class="text-muted-foreground text-[10px]">{user.role}</div>
            </div>
          </a>
          <button onclick={logout} class="text-[10px] text-muted-foreground hover:text-foreground shrink-0 px-1 underline">Sign out</button>
        {:else}
          <a href="/login" class="block w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            Sign in
          </a>
        {/if}
      </div>

      <!-- Copyright -->
      <div class="border-t border-border px-2 py-2 text-center text-[10px] text-muted-foreground">
        © {new Date().getFullYear()} Trailer · <a href="mailto:limoncc@icloud.com" class="underline hover:text-foreground">limoncc@icloud.com</a>
      </div>
  </aside>

  {#if confirmDelete}
    <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => confirmDelete = null} onkeydown={(e) => { if (e.key === 'Escape') confirmDelete = null; }}></div>
    <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl p-6 w-80">
      <h3 class="text-sm font-semibold mb-2">Delete Project</h3>
      {#if deleteError}
        <p class="text-xs text-destructive mb-3">{deleteError}</p>
      {:else}
        <p class="text-xs text-foreground mb-4">Delete project <strong>"{confirmDelete}"</strong> and all its runs?</p>
      {/if}
      <div class="flex gap-2 justify-end">
        <button onclick={() => confirmDelete = null} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
        <button onclick={deleteProject} disabled={!!deleteError}
          class="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded-md disabled:opacity-30">Delete</button>
      </div>
    </div>
  {/if}

  <!-- Drag handle -->
  <div
    class="w-1 shrink-0 cursor-col-resize hover:bg-ring/50 transition-colors bg-transparent" style="touch-action:none"
    role="presentation"
    onpointerdown={startDrag}
  ></div>

  <main class="flex-1 overflow-auto">
    {@render children()}
  </main>
</div>
