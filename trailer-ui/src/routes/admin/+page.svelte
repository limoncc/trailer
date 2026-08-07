<script lang="ts">
  import { onMount } from 'svelte';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  interface User { id: number; username: string; role: string; }

  let users = $state<User[]>([]);
  let loading = $state(true);
  let newUsername = $state('');
  let newPassword = $state('');
  let newRole = $state('experimenter');
  let error = $state('');
  let page = $state(1);
  let perPage = $state(20);

  // 统计需要全量,表格按当前页 slice(admin 用户量小)
  let pageUsers = $derived(users.slice((page - 1) * perPage, (page - 1) * perPage + perPage));

  function token() { return localStorage.getItem('trailer_token') || ''; }
  function headers() { return { 'content-type': 'application/json', authorization: `Bearer ${token()}` }; }

  onMount(async () => {
    const resp = await fetch('/api/v1/admin/users', { headers: headers() });
    if (resp.ok) users = await resp.json();
    loading = false;
  });

  async function createUser() {
    if (!newUsername || !newPassword) return;
    error = '';
    const resp = await fetch('/api/v1/admin/users', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    });
    if (resp.ok) {
      const u = await resp.json();
      users = [...users, u];
      newUsername = ''; newPassword = '';
    } else {
      const body = await resp.json().catch(() => ({}));
      error = body.error || 'Failed';
    }
  }

  async function setRole(id: number, role: string) {
    await fetch(`/api/v1/admin/users/${id}/role`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ role }),
    });
    users = users.map(u => u.id === id ? { ...u, role } : u);
  }
</script>

<svelte:head><title>Admin — Trailer</title></svelte:head>

<div class="p-6 max-w-3xl">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block">← Back</a>
  <h1 class="text-xl font-bold mb-4">Admin Dashboard</h1>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading...</p>
  {:else}
    <!-- Stats -->
    <div class="flex gap-4 mb-6">
      <div class="flex-1 border border-border rounded-md p-4 text-center">
        <p class="text-2xl font-bold">{users.length}</p>
        <p class="text-xs text-muted-foreground">Users</p>
      </div>
      <div class="flex-1 border border-border rounded-md p-4 text-center">
        <p class="text-2xl font-bold">{users.filter(u => u.role === 'admin').length}</p>
        <p class="text-xs text-muted-foreground">Admins</p>
      </div>
      <div class="flex-1 border border-border rounded-md p-4 text-center">
        <p class="text-2xl font-bold">{users.filter(u => u.role === 'experimenter').length}</p>
        <p class="text-xs text-muted-foreground">Experimenters</p>
      </div>
    </div>

    <!-- Create user -->
    <div class="border border-border rounded-md p-4 mb-6">
      <h2 class="text-sm font-semibold mb-3">Create User</h2>
      <div class="flex gap-2 items-end flex-wrap">
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="admin-username">Username</label>
          <input id="admin-username" bind:value={newUsername} class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="admin-password">Password</label>
          <input id="admin-password" bind:value={newPassword} type="password" class="px-2 py-1.5 text-xs border border-border rounded-md bg-background" />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-1" for="admin-role">Role</label>
          <select id="admin-role" bind:value={newRole} class="px-2 py-1.5 text-xs border border-border rounded-md bg-background">
            <option value="experimenter">Experimenter</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button onclick={createUser} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Create</button>
      </div>
      {#if error}<p class="text-xs text-destructive mt-2">{error}</p>{/if}
    </div>

    <!-- User table -->
    <div class="border border-border rounded-md overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/30 border-b border-border">
          <tr>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Username</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Role</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {#each pageUsers as u (u.id)}
            <tr class="hover:bg-muted/20">
              <td class="px-3 py-2 text-xs font-mono">{u.username}</td>
              <td class="px-3 py-2">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {u.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}">{u.role}</span>
              </td>
              <td class="px-3 py-2 text-right">
                {#if u.username !== 'admin'}
                  <button onclick={() => setRole(u.id, u.role === 'admin' ? 'experimenter' : 'admin')} class="text-[10px] text-muted-foreground hover:text-foreground underline">
                    {u.role === 'admin' ? 'Demote' : 'Promote'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <PaginationBar bind:page bind:perPage total={users.length} />
  {/if}
</div>
