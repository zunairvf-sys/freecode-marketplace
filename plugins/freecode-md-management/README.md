# FREECODE.md Management Plugin

Tools to maintain and improve FREECODE.md files - audit quality, capture session learnings, and keep project memory current.

## What It Does

Two complementary tools for different purposes:

| | freecode-md-improver (skill) | /revise-freecode-md (command) |
|---|---|---|
| **Purpose** | Keep FREECODE.md aligned with codebase | Capture session learnings |
| **Triggered by** | Codebase changes | End of session |
| **Use when** | Periodic maintenance | Session revealed missing context |

## Usage

### Skill: freecode-md-improver

Audits FREECODE.md files against current codebase state:

```
"audit my FREECODE.md files"
"check if my FREECODE.md is up to date"
```

<img src="freecode-md-improver-example.png" alt="FREECODE.md improver showing quality scores and recommended updates" width="600">

### Command: /revise-freecode-md

Captures learnings from the current session:

```
/revise-freecode-md
```

<img src="revise-freecode-md-example.png" alt="Revise command capturing session learnings into FREECODE.md" width="600">

## Author

Isabella He (isabella@freecode.com)
