# Festival `schedule.json`

The app loads **`festival-calendar/schedule.json` only** (no in-app editor). Edit that file in the project folder, then redeploy or re-upload the app so the phone picks up the new bundle.

**Flagged sets** are separate: they stay on the device in browser `localStorage` (`festival-flags-v1`) and are not part of this file.

## JSON schema (summary)

| Field | Notes |
| --- | --- |
| `festival` | Title string |
| `timezone` | e.g. `Europe/London` (organiser reference; **Now** uses the phone clock) |
| `days[]` | Each day: `id`, `label`, `date` (`YYYY-MM-DD`), `stages[]` |
| `stages[]` | `id`, `name`, optional `closesAt` / `closureNote`, `sets[]` |
| `sets[]` | `artist`, `start`, `end` (`HH:MM`); optional `kind: "closure"`, `note` |

**After-midnight** slot times (`00:00`–`05:59`) count as the night after `date` (Friday poster → Saturday morning).

A full Friday lineup lives in the bundled `schedule.json`. Add `days[]` for Saturday/Sunday when ready; empty days are hidden in the UI.

## Minimal sample

```json
{
  "festival": "My Festival",
  "timezone": "Europe/London",
  "days": [
    {
      "id": "friday",
      "label": "Friday",
      "date": "2026-11-13",
      "stages": [
        {
          "id": "main",
          "name": "Main Room",
          "sets": [
            { "artist": "Opening DJ", "start": "18:00", "end": "19:00" },
            { "artist": "Headliner", "start": "21:00", "end": "23:00" }
          ]
        }
      ]
    }
  ]
}
```
