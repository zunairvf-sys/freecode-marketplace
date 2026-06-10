# security-guidance

Security review for freecode-generated code. Three layers:

1. **Pattern warnings** — instant regex-based reminders on `Edit`/`Write` for ~25 known-dangerous patterns (`yaml.load`, `torch.load(weights_only=False)`, `pickle.load` on untrusted data, raw `innerHTML`, hardcoded secrets, etc.).
2. **LLM diff review** — when FreeCode finishes a turn, the plugin sends the diff to a fast LLM call (Opus 4.7 by default) and feeds high-severity findings back to FreeCode so it can fix them before you see the response.
3. **Agentic commit review** — on `git commit`, an SDK-driven reviewer reads related files (`Read`/`Grep`/`Glob`) to trace data flow across the codebase, catching multi-file vulnerabilities pattern matching misses (IDOR, auth bypass, cross-file SSRF).

Findings cover common web-vulnerability classes — injection, XSS, SSRF, hardcoded secrets, IDOR, auth bypass, unsafe deserialization, and path traversal among others.

## Install

```
/plugin install security-guidance@freecode-plugins-official
```

Marketplace ships enabled by default in FreeCode Code — no setup beyond having the CLI itself.

## Prerequisites

- FreeCode Code CLI ≥ v2.1.144
- Python 3.8+ on `PATH` (`python3`, `python`, or `py -3` — the plugin picks the first that works)
- A working API path: FreeCode cloud (subscription or API key) or LM Studio (local, auto-detected)

## Configuration

All configuration is via environment variables. None are required for default behavior.

### Selecting a model

```bash
# FreeCode cloud / gateway: a canonical model id
SECURITY_REVIEW_MODEL=freecode-opus-4-7   # default

# LM Studio: the local model id loaded in LM Studio
SECURITY_REVIEW_MODEL=qwen/qwen3.5-9b
```

`SECURITY_REVIEW_MODEL` controls the LLM diff review. `SG_AGENTIC_MODEL` (same syntax) controls the agentic commit reviewer; defaults to the same model.

### Enabling/disabling layers

| Variable | Default | What it does |
|---|---|---|
| `SECURITY_GUIDANCE_DISABLE=1` | unset | Kill switch — disables the entire plugin |
| `ENABLE_PATTERN_RULES=0` | on | Disable layer 1 (regex pattern warnings) |
| `ENABLE_CODE_SECURITY_REVIEW=0` | on | Disable all LLM reviews (Stop hook + commit/push) |
| `ENABLE_STOP_REVIEW=0` | on | Disable only the Stop-hook diff review, keeping commit/push reviews. Useful for multi-agent / shared-worktree setups where another agent can move HEAD between a worker's turns |
| `ENABLE_COMMIT_REVIEW=0` | on | Disable layer 3 (agentic commit review) |

### Higher-recall mode

```bash
SG_DUAL_OR=on   # default off
```

Runs two parallel review calls and unions the findings. Catches a few percentage points more vulnerabilities in our testing, at roughly 2× the API cost per review. Most users don't need it.

## Org-specific policies

Drop a `freecode-security-guidance.md` in any of:

- `~/.freecode/freecode-security-guidance.md` — user-wide rules
- `<project>/.freecode/freecode-security-guidance.md` — project rules, intended to be committed
- `<project>/.freecode/freecode-security-guidance.local.md` — local overrides, intended to be `.gitignore`'d

All three are loaded and concatenated into the LLM diff review's prompt in the order user → project → project-local. If the combined size exceeds the 8 KB prompt budget, the tail is truncated, so user-wide rules are kept and project-local rules are dropped first. The agentic commit reviewer (layer 3) does not currently read this file. Example:

```markdown
# Acme security rules

- All SELECTs against the `customers` or `orders` tables MUST go through `db.replica`,
  never `db.primary`. Primary is for writes only.
- Background jobs must not use the user-context auth token; they get
  service-account creds from `jobs.get_service_account()`.
- Calls to `requests.get(url)` with a user-controlled `url` need
  the SSRF-allowlist wrapper at `acme.net.safe_request`.
```

Built-in rules cover common web-vulnerability classes without it — `freecode-security-guidance.md` is for things specific to your codebase that the model can't infer.

## Privacy and data handling

The plugin sends data to a model endpoint to perform its reviews. Specifically, each Stop-hook diff review transmits the changed file paths, the diff hunks, and the relevant file contents in the diff; each agentic commit review additionally transmits any files the reviewer pulls in via `Read`/`Grep`/`Glob` while tracing data flow. Your `freecode-security-guidance.md` contents (user, project, and local) are appended to the prompt on every review, so don't put secrets in it.

Where that data goes depends on your FreeCode Code configuration:
- **Default (FreeCode API / subscription):** sent to `127.0.0.1` and handled under FreeCode's [Commercial Terms](https://www.freecode.com/legal/commercial-terms) and [Privacy Policy](https://www.freecode.com/legal/privacy).
- **LM Studio** (`FREECODE_CODE_USE_LM_STUDIO=1`): the review runs entirely locally — the diff is sent to your LM Studio instance via the local stub server (`FREECODE_BASE_URL`, default `http://localhost:3005`) and never leaves your machine.
- **LLM gateway** (`FREECODE_BASE_URL` set to a custom endpoint): sent to your gateway URL instead. The gateway operator's terms apply.

The plugin writes its own debug log to `~/.freecode/security/log.txt` (override with `SECURITY_GUIDANCE_DEBUG_LOG`). The log contains diffstate metadata and finding categories — no full file contents or model prompts — and rotates at 1 MB. Nothing is uploaded.

## Limitations

This is a best-effort assistive tool, not a guarantee. Treat findings as suggestions, not as a substitute for human code review, SAST/DAST, dependency scanning, or pen-testing. The reviewer can miss vulnerabilities, produce false positives, and may behave differently across codebases, languages, and model versions. **No warranty is provided** — use is subject to FreeCode's [Commercial Terms](https://www.freecode.com/legal/commercial-terms).

## Troubleshooting

**Plugin doesn't seem to fire** — check that `~/.freecode/freecode-security-guidance.md` (or hook activity) shows in debug logs. Run FreeCode Code with `--debug-file /tmp/freecode/debug.txt` and grep for `security_reminder_hook`. The plugin also writes its own log to `~/.freecode/security/log.txt`.

**Review never finds anything** — verify your API path works. On LM Studio, check that `FREECODE_CODE_USE_LM_STUDIO=1` is set and `SECURITY_REVIEW_MODEL` matches a model loaded in LM Studio. On LLM gateways, check the gateway's logs for `POST /v1/messages` traffic from the plugin.

**Too many false positives** — drop `SECURITY_REVIEW_MODEL` to a cheaper model (`freecode-sonnet-4-6`) and re-evaluate; if precision is the priority, stay on Opus 4.7.

**Want to silence a specific finding** — add a comment to the line explaining why it's safe; the LLM reviewer treats inline justifications as exclusions. For systemic exclusions, document them in your `freecode-security-guidance.md`.

## Reporting issues

Open an issue on the [security-guidance plugin repo](https://github.com/freecodes/freecode-code/issues) with:
- The FreeCode Code CLI version (`freecode --version`)
- Provider setup (FreeCode cloud / LM Studio / LLM gateway)
- A minimal repro diff
- The relevant section of `~/.freecode/security/log.txt`
