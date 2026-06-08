---
description: Configure your preferred package manager (npm/pnpm/yarn/bun)
disable-model-invocation: true
---

# Package Manager Setup

Configure your preferred package manager for this project or globally.

## Usage

```bash
# Detect current package manager
node scripts/setup-package-manager.js --detect

# Set global preference
node scripts/setup-package-manager.js --global pnpm

# Set project preference
node scripts/setup-package-manager.js --project bun

# List available package managers
node scripts/setup-package-manager.js --list
```

## Detection Priority

When determining which package manager to use, the following order is checked:

1. **Environment variable**: `freecode_PACKAGE_MANAGER`
2. **Project config**: `.freecode/package-manager.json`
3. **package.json**: `packageManager` field
4. **Lock file**: Presence of package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lockb
5. **Global config**: `~/.freecode/package-manager.json`
6. **Fallback**: First available package manager (pnpm > bun > yarn > npm)

## Configuration Files

### Global Configuration
```json
// ~/.freecode/package-manager.json
{
  "packageManager": "pnpm"
}
```

### Project Configuration
```json
// .freecode/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## Environment Variable

Set `freecode_PACKAGE_MANAGER` to override all other detection methods:

```bash
# Windows (PowerShell)
$env:freecode_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export freecode_PACKAGE_MANAGER=pnpm
```

## Run the Detection

To see current package manager detection results, run:

```bash
node scripts/setup-package-manager.js --detect
```
