"""The administrator's status page (plan-back Phase B): what is indexed, what was skipped or failed and why, what was
redacted, when the last sync ran and whether the three model servers answer. It shows the same data as
GET /admin/status. Plain HTML with no framework; every value that came from a document or a server is escaped."""
from __future__ import annotations

from html import escape

from .index import iso_utc

_STYLE = """
:root { color-scheme: light dark; --line: #cbd5e1; --muted: #55677a; --ok: #15803d; --bad: #b91c1c; }
@media (prefers-color-scheme: dark) { :root { --line: #334155; --muted: #94a3b8; --ok: #4ade80; --bad: #f87171; } }
body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; }
main { max-width: 980px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
.muted { color: var(--muted); } .ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.card b { display: block; font-size: 26px; line-height: 1.1; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; } .wrap { overflow-x: auto; }
button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; }
"""

_SCRIPT = """
document.getElementById('sync').addEventListener('click', async function () {
  var cookie = document.cookie.split('; ').find(function (c) { return c.indexOf('XSRF-TOKEN=') === 0; }) || '';
  var token = decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
  var out = document.getElementById('msg');
  try {
    var r = await fetch('/api/assistant/admin/sync', {method: 'POST', credentials: 'same-origin',
                                                       headers: {'X-XSRF-TOKEN': token}});
    out.textContent = r.status === 202 ? 'Sync started. Reload in a minute.'
                    : r.status === 409 ? 'A sync is already running.' : 'Could not start a sync (HTTP ' + r.status + ').';
  } catch (e) { out.textContent = 'Could not reach the assistant.'; }
});
"""


def _when(ts):
    return escape(iso_utc(ts) or "-")


def _cell(value):
    return escape("" if value is None else str(value))


def _table(headers, rows, empty):
    if not rows:
        return f'<p class="muted">{escape(empty)}</p>'
    head = "".join(f"<th>{escape(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
    return f'<div class="wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def render(status):
    docs, last = status["documents"], status.get("lastSync")
    cards = "".join(f'<div class="card"><b>{n}</b><span class="muted">{escape(label)}</span></div>'
                    for label, n in (("documents searchable", docs["indexed"]), ("skipped", docs["skipped"]),
                                     ("failed", docs["failed"]), ("passages indexed", status["chunks"])))
    if last:
        result = (f'started {_cell(last["startedAt"])}, finished {_cell(last["finishedAt"])}: '
                  f'{last["added"]} added, {last["removed"]} removed, {last["refreshed"]} refreshed, '
                  f'{last["failed"]} failed')
        error = f'<p class="bad">{_cell(last.get("error"))}</p>' if last.get("error") else ""
        sync = f'<p>{result}{" (a sync is running now)" if status["syncRunning"] else ""}</p>{error}'
    else:
        sync = '<p class="muted">No sync has finished yet.' + (" One is running now." if status["syncRunning"] else "") + "</p>"
    models = _table(("Server", "State"),
                    [(_cell(name), f'<span class="{"ok" if state == "ok" else "bad"}">{_cell(state)}</span>')
                     for name, state in status["models"].items()], "No model servers configured.")
    problems = _table(("Document", "Title", "State", "Why", "Tries", "Next try"),
                      [(_cell(p["document_number"]), _cell(p["name"]), _cell(p["state"]), _cell(p["reason"]),
                        _cell(p["attempts"]), _when(p["next_try_at"]) if p["state"] == "failed" else "-")
                       for p in status["problems"]], "Nothing skipped or failed.")
    redactions = _table(("Document", "Title", "Credentials replaced"),
                        [(_cell(r["document_number"]), _cell(r["name"]), _cell(r["redactions"]))
                         for r in status["redactions"]], "No credentials found in the indexed documents.")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assistant status</title><style>{_STYLE}</style></head>
<body><main>
<h1>Assistant status</h1>
<p class="muted">Source: {_cell(status["source"])} &middot; model: {_cell(status["model"])} &middot; prompt: {_cell(status["promptVersion"])}</p>
<div class="cards">{cards}</div>
<h2>Last sync</h2>{sync}
<p><button id="sync" type="button">Sync now</button> <span id="msg" class="muted"></span></p>
<h2>Model servers</h2>{models}
<h2>Skipped and failed documents</h2>{problems}
<h2>Credentials replaced while indexing</h2>{redactions}
</main><script>{_SCRIPT}</script></body></html>
"""
