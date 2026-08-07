<script lang="ts">
  import { Microscope } from 'lucide-svelte';
  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);
  let isRegister = $state(false);

  async function submit() {
    if (!username || !password) return;
    loading = true;
    error = '';
    const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (resp.ok) {
        const data = await resp.json();
        localStorage.setItem('trailer_token', data.token);
        localStorage.setItem('trailer_user', JSON.stringify(data.user));
        localStorage.removeItem('trailer_signed_out');
        window.location.href = '/';
      } else {
        const body = await resp.json().catch(() => ({}));
        error = body.error || 'Invalid credentials';
      }
    } catch { error = 'Connection failed'; }
    loading = false;
  }
</script>

<svelte:head><title>Login — Trailer</title></svelte:head>

<div class="flex items-center justify-center min-h-screen bg-background">
  <div class="w-80 p-8 border border-border rounded-xl bg-card shadow-sm">
    <div class="text-center mb-6">
      <Microscope class="size-12 mb-2 mx-auto text-foreground" />
      <h1 class="text-xl font-bold">Trailer</h1>
      <p class="text-xs text-muted-foreground mt-1">{isRegister ? 'Create account' : 'Sign in'}</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); submit(); }} class="space-y-3">
      <input bind:value={username} placeholder="Username" class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background" />
      <input bind:value={password} type="password" placeholder="Password" class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background" />
      {#if error}
        <p class="text-xs text-destructive">{error}</p>
      {/if}
      <button type="submit" disabled={loading} class="w-full py-2 text-sm bg-primary text-primary-foreground rounded-md font-medium disabled:opacity-50">
        {loading ? 'Please wait...' : isRegister ? 'Register' : 'Sign in'}
      </button>
    </form>

    <p class="text-xs text-center text-muted-foreground mt-4">
      {isRegister ? 'Already have an account?' : "Don't have an account?"}
      <button class="underline ml-1 text-foreground hover:text-primary" onclick={() => { isRegister = !isRegister; error = ''; }}>
        {isRegister ? 'Sign in' : 'Register'}
      </button>
    </p>

    <!-- Copyright -->
    <div class="text-center text-[10px] text-muted-foreground mt-6 border-t border-border pt-3">
      © {new Date().getFullYear()} Trailer · Elastic License 2.0 · <a href="mailto:limoncc@icloud.com" class="underline hover:text-foreground">limoncc@icloud.com</a>
    </div>
  </div>
</div>
