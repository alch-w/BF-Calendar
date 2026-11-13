# Festival `schedule.json`

The app loads **`schedule.json` only** (no in-app editor). Edit that file in the repo, then push so Netlify redeploys.

**Flagged sets** stay on the device in browser `localStorage` (`festival-flags-v1`) and are not part of this file.

## JSON schema (summary)

| Field | Notes |
| --- | --- |
| `festival` | Title string (e.g. `Bang Face`) |
| `timezone` | e.g. `Europe/London` (organiser reference; **Now** uses the phone clock) |
| `days[]` | Each day: `id`, `label`, `date` (`YYYY-MM-DD`), `stages[]` |
| `stages[]` | `id`, `name`, optional `closesAt` / `closureNote`, `sets[]` |
| `sets[]` | `artist`, `start`, `end` (`HH:MM`); optional `kind: "closure"`, `note` |

**After-midnight** slot times (`00:00`–`05:59`) count as the night after `date` (Saturday poster → Sunday morning).

The bundled `schedule.json` includes **Friday, Saturday, and Sunday** (2026-11-13 — 2026-11-16). The **Schedule** tab shows Fri / Sat / Sun buttons when multiple days have sets; **Now** auto-picks the active festival day from the phone date and clock.

## Minimal sample

```json
{
  "festival": "Bang Face",
  "timezone": "Europe/London",
  "days": [
    {
      "id": "friday",
      "label": "Friday",
      "date": "2026-11-13",
      "stages": [
        {
          "id": "bang-room",
          "name": "Bang",
          "sets": [
            { "artist": "Opening DJ", "start": "18:00", "end": "19:00" }
          ]
        }
      ]
    }
  ]
}
```
