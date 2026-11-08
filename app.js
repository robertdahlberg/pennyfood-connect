// Sign-in, consent and disconnect page for connecting Claude to PennyFood.
// Supabase Auth redirects here with ?authorization_id=... during OAuth. Opened
// without it, the page lists connected apps so access can be withdrawn.
;(function () {
  'use strict'

  const SUPABASE_URL = 'https://mwokgxnuxkqznngsbqpl.supabase.co'
  // Public by design: access is decided by row level security
  const PUBLISHABLE_KEY = 'sb_publishable_iZ8s5MZfMW3XCLiVrdZXBA_cxiLvaKt'
  const REDIRECT_HOSTS = ['claude.ai', 'claude.com']

  const el = id => document.getElementById(id)
  const views = ['login', 'consent', 'grants']

  // Consent must not be clickable through someone else's page
  if (window.top !== window.self) {
    el('status').textContent = 'Den här sidan kan inte visas inuti en annan sida.'
    return
  }

  const client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: {
      // Ends with the tab, so the session doesn't stay behind on this site
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })

  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')

  function setStatus(text, isError) {
    el('status').textContent = text
    el('status').className = isError ? 'error' : ''
  }

  function show(view) {
    views.forEach(name => {
      el(name).hidden = name !== view
    })
    el('sign-out').hidden = view === 'login'
  }

  function fail(text) {
    views.forEach(name => {
      el(name).hidden = true
    })
    setStatus(text, true)
  }

  function redirectHost(url) {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' && REDIRECT_HOSTS.includes(parsed.hostname)
        ? parsed.hostname
        : null
    } catch {
      return null
    }
  }

  // Only ever leaves for Claude, whatever the response says
  function returnToClient(url) {
    if (!redirectHost(url)) {
      fail('Appen vill skicka dig till en okänd adress, så inloggningen stoppades.')
      return
    }
    setStatus('Skickar dig tillbaka…')
    window.location.assign(url)
  }

  async function decide(action) {
    el('approve').disabled = true
    el('deny').disabled = true
    const { data, error } = await action(authorizationId, { skipBrowserRedirect: true })
    if (error || !data) {
      fail('Det gick inte att slutföra. Starta om anslutningen från Claude.')
      return
    }
    returnToClient(data.redirect_url)
  }

  async function showConsent() {
    const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId)
    if (error || !data) {
      fail('Förfrågan är ogiltig eller för gammal. Starta om anslutningen från Claude.')
      return
    }
    // Already approved earlier: no authorization_id means there's nothing to ask
    if (!data.authorization_id) {
      returnToClient(data.redirect_url)
      return
    }
    const host = redirectHost(data.redirect_uri)
    if (!host) {
      fail('Appen vill skicka dig till en okänd adress, så inloggningen stoppades.')
      return
    }
    el('client-name').textContent = data.client.name
    el('client-name-2').textContent = data.client.name
    el('user-email').textContent = data.user.email
    el('redirect-host').textContent = host
    setStatus('')
    show('consent')
  }

  async function disconnect(grant, button) {
    if (!window.confirm(`Koppla från ${grant.client.name}?`)) return
    button.disabled = true
    const { error } = await client.auth.oauth.revokeGrant({ clientId: grant.client.id })
    if (error) {
      setStatus('Det gick inte att koppla från. Försök igen.', true)
      button.disabled = false
      return
    }
    await showGrants()
  }

  async function showGrants() {
    const { data, error } = await client.auth.oauth.listGrants()
    if (error || !data) {
      fail('Det gick inte att hämta anslutna appar.')
      return
    }
    const list = el('grants-list')
    list.replaceChildren(
      ...data.map(grant => {
        const row = document.createElement('li')
        const name = document.createElement('span')
        name.textContent = grant.client.name
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Koppla från'
        button.addEventListener('click', () => disconnect(grant, button))
        row.append(name, button)
        return row
      }),
    )
    el('grants-empty').hidden = data.length > 0
    setStatus('')
    show('grants')
  }

  function showSignedIn() {
    return authorizationId ? showConsent() : showGrants()
  }

  el('login').addEventListener('submit', async event => {
    event.preventDefault()
    setStatus('Loggar in…')
    const { error } = await client.auth.signInWithPassword({
      email: el('email').value.trim(),
      password: el('password').value,
    })
    el('password').value = ''
    if (error) {
      setStatus('Inloggningen misslyckades. Kontrollera e-post och lösenord.', true)
      return
    }
    await showSignedIn()
  })

  el('approve').addEventListener('click', () =>
    decide((id, options) => client.auth.oauth.approveAuthorization(id, options)),
  )
  el('deny').addEventListener('click', () =>
    decide((id, options) => client.auth.oauth.denyAuthorization(id, options)),
  )

  el('sign-out').addEventListener('click', async () => {
    await client.auth.signOut({ scope: 'local' })
    setStatus('')
    show('login')
  })

  async function start() {
    const { data } = await client.auth.getSession()
    if (data.session) {
      await showSignedIn()
    } else {
      setStatus('')
      show('login')
    }
  }

  start().catch(() => fail('Något gick fel. Ladda om sidan.'))
})()
