---
name: calendar-manage
description: "Manage calendar events, check availability, and schedule meetings via Google Calendar API"
---

# Calendar Management Skill

Manage calendars, events, and scheduling using the Google Calendar API through MCP tools.

## Available MCP Tools

- `calendar_list_calendars` -- List all accessible calendars
- `calendar_get_events` -- Query events within a time range
- `calendar_create_event` -- Create a new calendar event
- `calendar_update_event` -- Modify an existing event
- `calendar_delete_event` -- Remove an event
- `calendar_get_event` -- Retrieve full event details
- `calendar_free_busy` -- Check availability for users
- `calendar_insert_quick_event` -- Quick-add with natural language

## Common Workflows

### Check today's schedule

```
calendar_get_events with:
  calendarId: "primary"
  timeMin: "<today>T00:00:00Z"
  timeMax: "<today>T23:59:59Z"
```

### Create a meeting

```
calendar_create_event with:
  summary: "Team Standup"
  startTime: "2026-06-13T09:00:00Z"
  endTime: "2026-06-13T09:15:00Z"
  attendees: ["alice@example.com", "bob@example.com"]
```

### Check availability before scheduling

```
calendar_free_busy with:
  emails: ["alice@example.com", "bob@example.com"]
  timeMin: "2026-06-13T09:00:00Z"
  timeMax: "2026-06-13T17:00:00Z"
```

### Quick event addition

```
calendar_insert_quick_event with:
  text: "Dentist appointment next Tuesday at 2pm"
```

### Find and update an event

1. Use `calendar_get_events` to locate the event
2. Note the event ID from results
3. Use `calendar_update_event` with the ID and new fields

### Delete an event

1. Use `calendar_get_events` to locate the event
2. Use `calendar_delete_event` with the event ID

## Time Format

All times should be provided in ISO 8601 format:
- Datetime: `2026-06-13T09:00:00Z`
- All-day: `2026-06-13`

When the user provides relative times ("tomorrow", "next week"), convert them to proper ISO 8601 dates before passing to tools.
