/**
 * The first-run page that asks which server to connect to. Rendered from a
 * data URL in its own window, so it needs no packaged file and runs no remote
 * code. It talks to the main process only through `window.desktop.server`.
 *
 * Pure module: no `electron` import, so it is unit-testable.
 */

export type PickerReason =
  | "empty"
  | "invalid"
  | "insecure"
  | "unreachable"
  | "not-navigator"
  | "forbidden";

const COPY = {
  en: {
    title: "Where do you want to connect?",
    intro:
      "Navigator runs in our cloud, or on your own server if you host better-chatbot yourself.",
    cloud: "keinsaas Navigator (cloud)",
    own: "My own server",
    beta: "Beta",
    placeholder: "https://my-chatbot.vercel.app",
    hint: "The address of your better-chatbot, e.g. the one Vercel gave you.",
    connect: "Connect",
    checking: "Checking the server…",
    errors: {
      empty: "Enter the address of your server.",
      invalid: "That is not a valid web address.",
      insecure: "The address must start with https://.",
      unreachable:
        "The server did not answer. Check the address and your connection.",
      "not-navigator":
        "A server answered, but it is not better-chatbot or Navigator.",
      forbidden: "This change is not allowed from here.",
    },
  },
  de: {
    title: "Womit möchtest du dich verbinden?",
    intro:
      "Navigator läuft in unserer Cloud oder auf deinem eigenen Server, wenn du better-chatbot selbst hostest.",
    cloud: "keinsaas Navigator (Cloud)",
    own: "Mein eigener Server",
    beta: "Beta",
    placeholder: "https://mein-chatbot.vercel.app",
    hint: "Die Adresse deines better-chatbot, z. B. die von Vercel.",
    connect: "Verbinden",
    checking: "Server wird geprüft…",
    errors: {
      empty: "Gib die Adresse deines Servers ein.",
      invalid: "Das ist keine gültige Web-Adresse.",
      insecure: "Die Adresse muss mit https:// beginnen.",
      unreachable:
        "Der Server hat nicht geantwortet. Prüfe die Adresse und deine Verbindung.",
      "not-navigator":
        "Unter der Adresse antwortet ein Server, aber kein better-chatbot oder Navigator.",
      forbidden: "Diese Änderung ist von hier aus nicht erlaubt.",
    },
  },
} as const;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] as string,
  );

export function buildServerPickerHtml(input: {
  locale: string;
  cloudUrl: string;
  previous?: string | null;
}): string {
  const t = input.locale.toLowerCase().startsWith("de") ? COPY.de : COPY.en;
  const previousIsOwn = Boolean(
    input.previous && input.previous !== input.cloudUrl,
  );
  const ownValue = previousIsOwn ? escapeHtml(input.previous as string) : "";
  // `<` would end the inline script early; JSON does not escape it.
  const errors = JSON.stringify(t.errors).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="${t === COPY.de ? "de" : "en"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Keinsaas Navigator</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --muted:#666; --bg:#fff; --card:#f6f6f7; --line:#d9d9de; --accent:#2563eb; --err:#c0262d; }
  @media (prefers-color-scheme: dark) { :root { --fg:#f2f2f3; --muted:#a1a1aa; --bg:#111113; --card:#1c1c1f; --line:#2e2e33; --accent:#60a5fa; --err:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); display:flex; min-height:100vh; align-items:center; justify-content:center; }
  main { width: min(480px, 100% - 48px); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: var(--muted); }
  label.option { display:flex; gap:12px; align-items:flex-start; padding:14px; border:1px solid var(--line); border-radius:10px; background:var(--card); margin-bottom:10px; cursor:pointer; }
  label.option:has(input:checked) { border-color: var(--accent); }
  .badge { font-size: 11px; padding: 1px 6px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); margin-left: 6px; }
  input[type=url] { width:100%; margin-top:8px; padding:9px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); font:inherit; }
  small { display:block; color:var(--muted); margin-top:6px; }
  button { margin-top: 12px; width:100%; padding:10px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #status { min-height: 1.5em; margin-top: 10px; color: var(--muted); }
  #status.error { color: var(--err); }
</style>
</head>
<body>
<main>
  <h1>${t.title}</h1>
  <p>${t.intro}</p>
  <!-- novalidate: a bare hostname is fine here (https is added), but the
       browser's url check would block it. -->
  <form id="form" novalidate>
    <label class="option">
      <input type="radio" name="mode" value="cloud"${previousIsOwn ? "" : " checked"}>
      <span>${t.cloud}</span>
    </label>
    <label class="option">
      <input type="radio" name="mode" value="own"${previousIsOwn ? " checked" : ""}>
      <span style="flex:1">${t.own}<span class="badge">${t.beta}</span>
        <input type="url" id="url" placeholder="${t.placeholder}" value="${ownValue}" autocomplete="url" spellcheck="false">
        <small>${t.hint}</small>
      </span>
    </label>
    <button type="submit" id="connect">${t.connect}</button>
    <div id="status" role="status"></div>
  </form>
</main>
<script>
  const errors = ${errors};
  const form = document.getElementById("form");
  const url = document.getElementById("url");
  const button = document.getElementById("connect");
  const status = document.getElementById("status");
  url.addEventListener("focus", () => { form.mode.value = "own"; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.className = "";
    status.textContent = ${JSON.stringify(t.checking)};
    const mode = form.mode.value === "own" ? "own" : "cloud";
    const result = await window.desktop.server.choose({ mode, url: url.value });
    if (result && result.ok) return;
    status.className = "error";
    status.textContent = errors[result && result.reason] || errors.invalid;
    button.disabled = false;
  });
</script>
</body>
</html>`;
}
