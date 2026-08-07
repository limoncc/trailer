<script lang="ts">
  import { onMount } from 'svelte';

  interface User { id: number; username: string; role: string; }
  interface ProjectAccessInfo { project: string; role: string; }
  interface ApiToken { token: string; user_id: number; name: string | null; created_at: number; expires_at: number | null; }
  let user = $state<User | null>(null);
  let allUsers = $state<User[]>([]);
  let newUsername = $state('');
  let newPassword = $state('');
  let newRole = $state('experimenter');
  let error = $state('');

  // 用户项目归属(admin 查看)
  let userProjects = $state<Map<number, ProjectAccessInfo[]>>(new Map());

  // API Token 管理(所有登录用户)
  let apiTokens = $state<ApiToken[]>([]);
  let newTokenName = $state('');
  let newTokenExpiry = $state('permanent');
  let justCreatedToken = $state<string | null>(null);
  let tokenError = $state('');
  /** 待删除的 token(打开自定义确认弹框) */
  let tokenToDelete = $state<ApiToken | null>(null);
  /** 生成永久 token 的自定义确认弹框 */
  let confirmPermanent = $state(false);
  /** Copy 成功提示 */
  let copiedMsg = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  function token() { return localStorage.getItem('trailer_token') || ''; }
  function hdrs() { return { 'content-type': 'application/json', authorization: `Bearer ${token()}` }; }

  onMount(async () => {
    const stored = localStorage.getItem('trailer_user');
    if (stored) user = JSON.parse(stored);
    await loadTokens();
    if (user?.role === 'admin') await loadUsers();
  });

  /** 加载当前用户的 API tokens。 */
  async function loadTokens() {
    try {
      const r = await fetch('/api/v1/tokens', { headers: hdrs() });
      if (r.ok) apiTokens = await r.json();
    } catch {}
  }

  /** 生成 token;永久需自定义确认弹框。 */
  function createToken() {
    if (newTokenExpiry === 'permanent') { confirmPermanent = true; return; }
    doCreateToken();
  }

  async function doCreateToken() {
    tokenError = '';
    const days = newTokenExpiry === 'permanent' ? null : parseInt(newTokenExpiry);
    const r = await fetch('/api/v1/tokens', {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ name: newTokenName || null, expires_in_days: days }),
    });
    if (r.ok) {
      const data = await r.json();
      justCreatedToken = data.token;
      newTokenName = '';
      await loadTokens();
    } else {
      const b = await r.json().catch(() => ({}));
      tokenError = b.error || `HTTP ${r.status}`;
    }
  }

  /** 复制 token 到剪贴板并提示。 */
  async function copyToken() {
    if (!justCreatedToken) return;
    try { await navigator.clipboard.writeText(justCreatedToken); } catch {}
    copiedMsg = 'Copied!';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => copiedMsg = '', 2000);
  }

  /** 删除 token(立即失效) — 打开自定义确认弹框。 */
  function deleteToken(t: ApiToken) {
    tokenToDelete = t;
  }

  async function confirmDeleteToken() {
    if (!tokenToDelete) return;
    await fetch(`/api/v1/tokens/${encodeURIComponent(tokenToDelete.token)}`, { method: 'DELETE', headers: hdrs() });
    tokenToDelete = null;
    await loadTokens();
  }

  function maskToken(t: string): string {
    if (t.length <= 12) return t;
    return t.slice(0, 6) + '…' + t.slice(-4);
  }

  function tokenStatus(t: ApiToken): { label: string; cls: string } {
    if (t.expires_at == null) return { label: 'Permanent', cls: 'bg-muted text-muted-foreground' };
    if (t.expires_at < Date.now() / 1000) return { label: 'Expired', cls: 'bg-destructive/10 text-destructive' };
    return { label: 'Active', cls: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400' };
  }

  async function loadUsers() {
    const tok = token();
    if (!tok) { goLogin(); return; }
    const resp = await fetch('/api/v1/admin/users', { headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` } });
    if (resp.ok) {
      allUsers = await resp.json();
      await loadUserProjects();
    } else if (resp.status === 401) goLogin();
  }

  /** 并行加载每个用户拥有的项目。 */
  async function loadUserProjects() {
    const projMap = new Map<number, ProjectAccessInfo[]>();
    await Promise.all(allUsers.map(async (u) => {
      try {
        const r = await fetch(`/api/v1/admin/users/${u.id}/projects`, { headers: hdrs() });
        if (r.ok) projMap.set(u.id, await r.json());
      } catch {}
    }));
    userProjects = projMap;
  }

  function goLogin() {
    localStorage.removeItem('trailer_token');
    localStorage.removeItem('trailer_user');
    window.location.href = '/login';
  }

  let debugMsg = $state('');
  let pwOld = $state('');
  let pwNew = $state('');
  let pwMsg = $state('');
  let resetTarget = $state<number | null>(null);
  let resetPw = $state('');

  async function createUser() {
    if (!newUsername || !newPassword) return;
    error = '';
    debugMsg = 'Creating...';
    const resp = await fetch('/api/v1/admin/users', {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    });
    debugMsg = `API: ${resp.status}`;
    if (resp.ok) {
      await loadUsers();
      newUsername = '';
      newPassword = '';
      debugMsg = 'User created!';
      setTimeout(() => debugMsg = '', 2000);
    } else {
      const b = await resp.json().catch(() => ({}));
      error = b.error || `HTTP ${resp.status}`;
      debugMsg = error;
    }
  }

  async function changeMyPassword() {
    if (!pwOld || !pwNew) return;
    pwMsg = '';
    const resp = await fetch('/api/v1/auth/password', {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({ old_password: pwOld, new_password: pwNew }),
    });
    pwMsg = resp.ok ? 'Password changed' : 'Failed — wrong password';
    if (resp.ok) { pwOld = ''; pwNew = ''; }
  }

  async function resetUserPassword(id: number) {
    if (!resetPw) return;
    await fetch(`/api/v1/admin/users/${id}/password`, {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({ new_password: resetPw }),
    });
    resetTarget = null; resetPw = '';
  }

  async function deleteUser(id: number) {
    if (!confirm('Delete user?')) return;
    await fetch(`/api/v1/admin/users/${id}`, { method: 'DELETE', headers: hdrs() });
    await loadUsers();
  }

  async function setRole(id: number, role: string) {
    await fetch(`/api/v1/admin/users/${id}/role`, { method: 'PUT', headers: hdrs(), body: JSON.stringify({ role }) });
    await loadUsers();
  }

  function logout() {
    localStorage.removeItem('trailer_token');
    localStorage.removeItem('trailer_user');
    window.location.href = '/login';
  }
</script>

<svelte:head><title>Profile — Trailer</title></svelte:head>

<div class="p-6 max-w-2xl">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">← Back</a>

  {#if user}
    <!-- Personal Info -->
    <div class="flex items-center gap-4 mb-6">
      <span class="w-14 h-14 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-xl font-bold shrink-0">
        {user.username[0].toUpperCase()}
      </span>
      <div>
        <h1 class="text-xl font-bold">{user.username}</h1>
        <p class="text-xs text-muted-foreground">ID {user.id} · {user.role === 'admin' ? 'Administrator' : 'Experimenter'}</p>
      </div>
      <button onclick={logout} class="ml-auto px-3 py-1 text-xs border border-border rounded-md hover:bg-accent shrink-0">Sign Out</button>
    </div>

    <!-- Change Password -->
    <div class="border border-border rounded-md p-4 mb-6">
      <h2 class="text-sm font-semibold mb-3">Change Password</h2>
      <div class="flex gap-2 items-end flex-wrap">
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="pw-current">Current</label>
          <input id="pw-current" bind:value={pwOld} type="password" class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="pw-new">New</label>
          <input id="pw-new" bind:value={pwNew} type="password" class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <button onclick={changeMyPassword} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Update</button>
      </div>
      {#if pwMsg}<p class="text-xs {pwMsg === 'Password changed' ? 'text-green-600' : 'text-destructive'} mt-1">{pwMsg}</p>{/if}
    </div>

    <!-- API Tokens -->
    <div class="border border-border rounded-md p-4 mb-6">
      <h2 class="text-sm font-semibold mb-1">API Tokens</h2>
      <p class="text-xs text-muted-foreground mb-3">For Python SDK remote mode (<code class="font-mono">TRAILER_TOKEN</code>). Tokens are shown in full only once at creation; after closing, they cannot be viewed again.</p>

      {#if justCreatedToken}
        <div class="bg-primary/10 border border-primary/30 rounded-md p-3 mb-3">
          <p class="text-xs font-semibold mb-1">New token generated (shown only once — copy it now):</p>
          <div class="flex items-center gap-2">
            <code class="text-xs font-mono bg-background px-2 py-1 rounded border border-border flex-1 break-all">{justCreatedToken}</code>
            <button onclick={copyToken} class="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md shrink-0">Copy</button>
            {#if copiedMsg}<span class="text-xs text-green-600 shrink-0">{copiedMsg}</span>{/if}
            <button onclick={() => justCreatedToken = null} class="px-2 py-1 text-xs border border-border rounded-md shrink-0">Close</button>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 items-end flex-wrap mb-3">
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="tok-name">Name</label>
          <input id="tok-name" bind:value={newTokenName} placeholder="e.g. ci" class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="tok-expiry">Expiry</label>
          <select id="tok-expiry" bind:value={newTokenExpiry} class="px-2 py-1.5 text-xs border border-border rounded-md bg-background">
            <option value="permanent">Permanent</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <button onclick={createToken} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Generate</button>
      </div>
      {#if tokenError}<p class="text-xs text-destructive mb-2">{tokenError}</p>{/if}

      {#if apiTokens.length > 0}
        <div class="border border-border rounded-md overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-muted/30 border-b border-border">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Token</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Created</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Expires</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {#each apiTokens as t (t.token)}
                <tr class="hover:bg-muted/20">
                  <td class="px-3 py-2 text-xs">{t.name || '—'}</td>
                  <td class="px-3 py-2"><code class="text-[10px] font-mono text-muted-foreground">{maskToken(t.token)}</code></td>
                  <td class="px-3 py-2 text-xs text-muted-foreground">{t.created_at ? new Date(t.created_at * 1000).toLocaleString() : '—'}</td>
                  <td class="px-3 py-2 text-xs text-muted-foreground">{t.expires_at ? new Date(t.expires_at * 1000).toLocaleString() : '—'}</td>
                  <td class="px-3 py-2">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {tokenStatus(t).cls}">{tokenStatus(t).label}</span>
                  </td>
                  <td class="px-3 py-2 text-right">
                    <button onclick={() => deleteToken(t)} class="text-[10px] underline text-destructive">Delete</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-xs text-muted-foreground">No API tokens yet.</p>
      {/if}
    </div>

    <!-- User Management (admin only) -->
    {#if user.role === 'admin'}
      <h2 class="text-sm font-semibold mb-3 border-b border-border pb-2">User Management</h2>

      <div class="flex gap-2 items-end flex-wrap mb-4">
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="profile-username">Username</label>
          <input id="profile-username" bind:value={newUsername} class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="profile-password">Password</label>
          <input id="profile-password" bind:value={newPassword} type="password" class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="profile-role">Role</label>
          <select id="profile-role" bind:value={newRole} class="px-2 py-1.5 text-xs border border-border rounded-md bg-background appearance-none">
            <option value="experimenter">Experimenter</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button onclick={createUser} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Create</button>
      </div>
      {#if error}<p class="text-xs text-destructive mb-2">{error}</p>{/if}
      {#if debugMsg}<p class="text-xs text-muted-foreground mb-2">{debugMsg}</p>{/if}

      <div class="border border-border rounded-md overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-muted/30 border-b border-border">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Username</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Role</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Projects</th>
              <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {#each allUsers as u (u.id)}
              <tr class="hover:bg-muted/20">
                <td class="px-3 py-2 text-xs font-mono">{u.username}</td>
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {u.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}">{u.role}</span>
                </td>
                <td class="px-3 py-2">
                  {#if (userProjects.get(u.id) || []).length === 0}
                    <span class="text-xs text-muted-foreground">—</span>
                  {:else}
                    <div class="flex items-center gap-1.5">
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary shrink-0">{(userProjects.get(u.id) || []).length}</span>
                      <select class="px-1.5 py-1 text-xs border border-border rounded-md bg-background max-w-[150px]">
                        {#each userProjects.get(u.id) || [] as p (p.project)}
                          <option value={p.project}>{p.project}:{p.role}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right space-x-2">
                  {#if u.role === 'experimenter'}
                    <button onclick={() => setRole(u.id, 'admin')} class="text-[10px] underline text-muted-foreground hover:text-foreground">Promote</button>
                  {/if}
                  {#if u.username !== 'admin'}
                    <button onclick={() => { resetTarget = u.id; resetPw = ''; }} class="text-[10px] underline text-muted-foreground hover:text-foreground">Reset PW</button>
                    <button onclick={() => deleteUser(u.id)} class="text-[10px] underline text-destructive">Delete</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if resetTarget !== null}
          <div class="flex items-center gap-2 mt-3 p-3 bg-muted/30 rounded-md">
            <span class="text-xs text-muted-foreground">New password for user #{resetTarget}:</span>
            <input bind:value={resetPw} type="password" placeholder="new password" class="flex-1 px-2 py-1 text-xs border border-border rounded-md bg-background" />
            <button onclick={() => resetUserPassword(resetTarget)} disabled={!resetPw} class="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-30">Reset</button>
            <button onclick={() => { resetTarget = null; resetPw = ''; }} class="px-2 py-1 text-xs border border-border rounded-md">Cancel</button>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <p class="text-center text-muted-foreground py-8">Please sign in</p>
    <a href="/login" class="block text-center text-sm text-primary">Sign in</a>
  {/if}
</div>

{#if tokenToDelete}
  <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => tokenToDelete = null} onkeydown={(e) => { if (e.key === 'Escape') tokenToDelete = null; }}></div>
  <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-destructive/30 rounded-xl shadow-xl p-6 w-80">
    <h3 class="text-sm font-semibold mb-2 text-destructive">Revoke API Token</h3>
    <p class="text-xs text-foreground mb-4">Delete <strong>{tokenToDelete.name || 'Unnamed'}</strong>? Requests using it will stop working immediately.</p>
    <div class="flex gap-2 justify-end">
      <button onclick={() => tokenToDelete = null} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
      <button onclick={confirmDeleteToken} class="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded-md">Revoke</button>
    </div>
  </div>
{/if}

{#if confirmPermanent}
  <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => confirmPermanent = false} onkeydown={(e) => { if (e.key === 'Escape') confirmPermanent = false; }}></div>
  <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl p-6 w-80">
    <h3 class="text-sm font-semibold mb-2">Generate Permanent Token</h3>
    <p class="text-xs text-foreground mb-4">Permanent tokens never expire. Keep them safe. Create anyway?</p>
    <div class="flex gap-2 justify-end">
      <button onclick={() => confirmPermanent = false} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
      <button onclick={() => { confirmPermanent = false; doCreateToken(); }} class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md">Generate</button>
    </div>
  </div>
{/if}
