# Festival `schedule.json`

The app loads **`schedule.json` only** (no in-app editor). Edit that file in the repo, then push so Netlify redeploys.

**Flagged sets** stay on the device in browser `localStorage` (`festival-flags-v1`) and are not part of this file. The Now tab **Today only** filter for flagged upcoming uses `festival-flags-today-only-v1`.

## JSON schema (summary)

| Field | Notes |
| --- | --- |
| `festival` | Title string (e.g. `Bang Face`) |
| `timezone` | e.g. `Europe/London` (organiser reference; **Now** uses the phone clock) |
| `notes` | Optional organiser notes (e.g. after-midnight / open-ended set rules); not shown in the UI |
| `days[]` | Each day: `id`, `label`, `date` (`YYYY-MM-DD`), `stages[]` |
| `days[].extras` | Optional array of non-stage items (pool parties, cinema, etc.). **Validated but not rendered** in v1 — the app ignores extras. |
| `stages[]` | `id`, `name`, optional `closesAt` / `closureNote` / `notes`, `sets[]` |
| `sets[]` | `artist`, `start`, `end` (`HH:MM` or `null`); optional `kind: "closure"`, `note` |

**Stage names** use the full room label in `name` (e.g. `Bang Room`, `Face Room`) — the UI shows `stage.name` as-is.

**Open-ended sets** (`end: null`): the app infers end time when rendering:

1. If another set follows on the same stage, end = that set’s `start`.
2. Else if this is the last set on the stage and `start` is after `04:00`, end = start + 1 hour.
3. Else if the stage has `closesAt`, end = room close.
4. Otherwise end = start + 1 hour.

**After-midnight** slot times (`00:00`–`05:59`) count as the night after `date` (Saturday poster → Sunday morning).

The bundled `schedule.json` includes **Friday, Saturday, and Sunday** (`2026-11-13`, `2026-11-14`, `2026-11-15`; festival runs through Mon 2026-11-16). The **Schedule** tab shows Fri / Sat / Sun buttons when multiple days have sets; **Now** auto-picks the active festival day from the phone date and clock.

Optional **`stages[].notes`** appear as subtle text under the stage name on the **Schedule** grid only.

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
          "name": "Bang Room",
          "sets": [
            { "artist": "Opening DJ", "start": "18:00", "end": "19:00" }
          ]
        }
      ]
    }
  ]
}
```
