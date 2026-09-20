# Panel label fields

The Framing workspace prints the selected panel through the backend's configured
Zebra ZD420. The operator opens the printer icon, reviews the label, and presses
the printer icon in the dialog. The admin Etiquetas page uses the same preview
and print layout for the panel with the most recent task activity.

## Field sources

| Label | Source | Example from the synced database |
| --- | --- | --- |
| Panel | `PanelDefinition.panel_code` | `C-09` |
| Proyecto | `WorkOrder.project_name` | `PADRE HURTADO` |
| Modelo | `HouseType.name` and `HouseSubType.name` | `THS-A` |
| Módulo | `WorkUnit.module_number`, formatted as `MD` plus the number | `MD1` |
| Número junto al proyecto, con `#` | Trailing house number from `WorkOrder.house_identifier` | `PH #34` becomes `34` |
| Área | `PanelDefinition.panel_area`, in square metres | `26.34 m²` |
| Fecha | Current date in `America/Santiago` when the preview loads | `14/09/2026` |

The example resolves to work order 517, work unit 1207, panel definition 210,
and panel unit 6819. Its model is THS, subtype A. All label fields resolve without
operator input. The photograph's original date is not copied to new labels.

The full external code `THSA-C-2-01-C-09` is not stored in these records. The
abbreviated panel code is used as agreed. The legacy Padre Hurtado catalogue
stores model names such as `THS A` in the subtype, so that subtype supplies the
label's model. Other catalogues combine the house type and subtype.

## Missing data and corrections

The database inspection on 2026-09-14 found 167 of 212 active panel definitions
with an area value. Area comes directly from the catalogue, without inferring dimensions.

The print dialog has no manual label-field controls. Missing data blocks printing
and identifies the catalogue or work-order fields that need correction. Operators
can choose the number of copies. All label values come from production data.

## Rendering and access

The five main identification fields use large type. Area and date use
smaller type along the bottom. SVG preview and rotated ZPL output share the same
text and divider-line layout. An outer border and section dividers separate the rows. The existing media settings remain 799 × 1618 dots at 203 DPI,
approximately 99.9 × 202.3 mm, displayed in landscape orientation. Browser and
printer fonts can differ slightly; physical alignment still needs a printer check.

Worker preview and print endpoints require an active worker session whose station
is Framing with role Panels. The backend also checks that the selected panel is
available in the current station snapshot, including planned panels that do not
yet have a PanelUnit. Print requests reload the source data and recheck access.
Printing does not start tasks or advance production.

The printer receives ZPL over the existing configured TCP connection. A successful
send confirms transmission, not paper output. A connection error asks the operator
to check the printer before retrying because a partial send may already have printed.
The dialog prevents repeated clicks and closing while a send is in progress.

## Verification and local environment

Backend tests cover mappings, area validation, missing data, station access,
panel eligibility, and ZPL escaping. Frontend checks use TypeScript, ESLint,
and the Vite production build. Browser verification uses the local Framing session.
No physical label was printed during development.

The Windows sandbox could not launch the project's base Python, and `uv` was not
on its PATH. Tests and database reads used the existing `.venv/Scripts/python.exe`
with tool approval. No dependencies were installed or changed. Git's ownership
check was handled with a command-local `safe.directory` setting.

The tracked `.pnpm-store/v11/projects/bc7dd3c3c75171d96f01753bb0438291` directory is
a Windows junction to `ui`. Git therefore reports the same UI edits under both
paths. The junction remains unchanged; repository maintenance should remove the
tracked package-store copy separately.
