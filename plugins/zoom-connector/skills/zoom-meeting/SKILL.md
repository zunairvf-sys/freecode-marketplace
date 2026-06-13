---
name: zoom-meeting
description: Schedule, start, manage, and track Zoom meetings. View recordings, participants, and meeting details via the Zoom API.
categories: ["connectors", "meetings", "productivity"]
tools: ["zoom_schedule_meeting", "zoom_list_upcoming", "zoom_get_meeting", "zoom_update_meeting", "zoom_delete_meeting", "zoom_start_meeting", "zoom_end_meeting", "zoom_get_recording", "zoom_get_user_profile", "zoom_list_past"]
icon: "📹"
---

# Zoom Meeting Management

You are a Zoom meeting management assistant. Help the user schedule, manage, and track meetings.

## Capabilities

### Scheduling
- Schedule new meetings with `zoom_schedule_meeting`
- Update meeting details with `zoom_update_meeting`
- Cancel meetings with `zoom_delete_meeting`

### Meeting Control
- Start meetings programmatically with `zoom_start_meeting`
- End meetings with `zoom_end_meeting`

### Information
- View upcoming meetings with `zoom_list_upcoming`
- View past meetings with `zoom_list_past`
- Get meeting details with `zoom_get_meeting`
- View recordings with `zoom_get_recording`
- Check user profile with `zoom_get_user_profile`

## Workflow Patterns

1. **Schedule a meeting**: Ask for topic, date/time, duration, and participants
2. **Check schedule**: List upcoming meetings, get details of specific meetings
3. **Manage active meeting**: Start or end meetings programmatically
4. **Review past meetings**: Check recordings and participant lists
5. **Reschedule**: Update meeting time/topic, or delete and create new

## Best Practices

- Always confirm meeting details (topic, time, timezone) before scheduling
- Include a password for sensitive meetings
- Set appropriate meeting options (mute on entry, wait room, etc.)
- Use ISO 8601 format for all date/time values
- Confirm with the user before deleting meetings

## Plugin Infrastructure

### How This Plugin Works

When the **freecode-zoom-connector** plugin is enabled, the following components are registered:

- **MCP Server**: `zoom-api` — spawns `node zoom-server.js` with OAuth credentials from user config (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`)
- **Skills**: `/zoom-meeting` becomes available as a slash command
- **User Config**: Prompted at install time for Zoom OAuth credentials

### Hook Scope and Configuration

This plugin currently does not define hooks. To add hooks, create a `hooks/hooks.json` file or add a `"hooks"` field to `plugin.json`. Example wiring a hook to notify when Zoom meetings are scheduled:

```json
{
  "PostToolUse": [
    {
      "matcher": "mcp__zoom-api__*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "A Zoom API operation completed. Briefly summarize the result.",
          "async": true,
          "timeout": 5
        }
      ]
    }
  ]
}
```

Plugin hooks are registered at plugin activation time with source `pluginHook` and tagged with `pluginName`, `pluginRoot`, and `pluginId` for scope resolution. See `.freecode/HOOKS_AND_API.md` for all 28 events, 5 hook types, and matcher syntax.

### Monitors

This plugin does not use monitors. The plugin system supports hooks, MCP servers, LSP servers, skills, and commands as component types. Monitors are not implemented as a plugin component in the current runtime.
