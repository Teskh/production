# Stations

This document describes the current stations and how the station data model works today, plus the
proposed adjustments for how it should work going forward.

## Current stations (seed data)

**Purpose overview**
- W1 Framing: panel framing start.
- W2 Mesa 1: panel line table 1.
- W3 Puente 1: panel line bridge 1.
- W4 Mesa 2: panel line table 2.
- W5 Puente 2: panel line bridge 2.
- W6 Mesa 3: panel line table 3.
- W7 Puente 3: panel line bridge 3.
- W8 Mesa 4: panel line table 4.
- W9 Puente 4: panel line bridge 4.
- M1 Magazine: buffer between panels and assembly lines.
- A0/B0/C0 Linea 1/2/3 - Armado: line start/armado staging for assembly lines 1-3.
- A1..A6 / B1..B6 / C1..C6 Estacion 1-6: assembly workstations for lines 1-3.
- AUX1 Sheathing Prep Saw: auxiliary station for prep work.

**Current stations expressed in the proposed shape (json-like)**
```
[
  {"station_id":1,"name":"Framing","role":"Panels","line_type":null,"sequence_order":1},
  {"station_id":2,"name":"Mesa 1","role":"Panels","line_type":null,"sequence_order":2},
  {"station_id":3,"name":"Puente 1","role":"Panels","line_type":null,"sequence_order":3},
  {"station_id":4,"name":"Mesa 2","role":"Panels","line_type":null,"sequence_order":4},
  {"station_id":5,"name":"Puente 2","role":"Panels","line_type":null,"sequence_order":5},
  {"station_id":6,"name":"Mesa 3","role":"Panels","line_type":null,"sequence_order":6},
  {"station_id":7,"name":"Puente 3","role":"Panels","line_type":null,"sequence_order":7},
  {"station_id":8,"name":"Mesa 4","role":"Panels","line_type":null,"sequence_order":8},
  {"station_id":9,"name":"Puente 4","role":"Panels","line_type":null,"sequence_order":9},
  {"station_id":10,"name":"Magazine","role":"Magazine","line_type":null,"sequence_order":10},
  {"station_id":11,"name":"Linea 1 - Armado","role":"Assembly","line_type":"1","sequence_order":11},
  {"station_id":12,"name":"Linea 2 - Armado","role":"Assembly","line_type":"2","sequence_order":11},
  {"station_id":13,"name":"Linea 3 - Armado","role":"Assembly","line_type":"3","sequence_order":11},
  {"station_id":14,"name":"Estacion 1","role":"Assembly","line_type":"1","sequence_order":12},
  {"station_id":15,"name":"Estacion 1","role":"Assembly","line_type":"2","sequence_order":12},
  {"station_id":16,"name":"Estacion 1","role":"Assembly","line_type":"3","sequence_order":12},
  {"station_id":17,"name":"Estacion 2","role":"Assembly","line_type":"1","sequence_order":13},
  {"station_id":18,"name":"Estacion 2","role":"Assembly","line_type":"2","sequence_order":13},
  {"station_id":19,"name":"Estacion 2","role":"Assembly","line_type":"3","sequence_order":13},
  {"station_id":20,"name":"Estacion 3","role":"Assembly","line_type":"1","sequence_order":14},
  {"station_id":21,"name":"Estacion 3","role":"Assembly","line_type":"2","sequence_order":14},
  {"station_id":22,"name":"Estacion 3","role":"Assembly","line_type":"3","sequence_order":14},
  {"station_id":23,"name":"Estacion 4","role":"Assembly","line_type":"1","sequence_order":15},
  {"station_id":24,"name":"Estacion 4","role":"Assembly","line_type":"2","sequence_order":15},
  {"station_id":25,"name":"Estacion 4","role":"Assembly","line_type":"3","sequence_order":15},
  {"station_id":26,"name":"Estacion 5","role":"Assembly","line_type":"1","sequence_order":16},
  {"station_id":27,"name":"Estacion 5","role":"Assembly","line_type":"2","sequence_order":16},
  {"station_id":28,"name":"Estacion 5","role":"Assembly","line_type":"3","sequence_order":16},
  {"station_id":29,"name":"Estacion 6","role":"Assembly","line_type":"1","sequence_order":17},
  {"station_id":30,"name":"Estacion 6","role":"Assembly","line_type":"2","sequence_order":17},
  {"station_id":31,"name":"Estacion 6","role":"Assembly","line_type":"3","sequence_order":17},
  {"station_id":32,"name":"Sheathing Prep Saw","role":"AUX","line_type":null,"sequence_order":null}
]
```

## Current data model (how it works today)

Stations are stored in a `Stations` table with these columns:
- `station_id` (TEXT, PK): an ID such as W1, M1, A1, etc. IDs implicitly encode type and line.
- `name` (TEXT): business-facing name shown in UI.
- `line_type` (TEXT): W (Panels), M (Magazine), A/B/C (Assembly lines), or AUX (auxiliary).
- `sequence_order` (INTEGER, nullable): order of flow within a line; NULL for aux stations.
- `role` (TEXT): semantic tag, currently `core` or `auxiliary`.

Flow uses `sequence_order` within a `line_type` (e.g., W1 -> W2 -> ... -> W9, or A1 -> A2 -> ... in line A).
Auxiliary stations are identified by `role = auxiliary` (or line types outside W/M/A/B/C) and do not
participate in the main flow.

## Proposed adjustments (how stations should work)

These changes preserve the current sequencing and names but simplify how station identity is encoded.

**Data model changes**
- `role` becomes the station type: `Panels`, `Magazine`, `Assembly`, or `AUX`.
- `line_type` is `NULL` for most stations; it is only used to distinguish parallel assembly lines.
  - Use line labels `1`, `2`, `3` (instead of A/B/C) when `role = Assembly`.
- `sequence_order` continues to indicate flow order (same numeric order as today).
- `name` stays as the business name.
- `station_id` becomes a plain autoincrement integer (no embedded meaning).

**Flow rules with the new model**
- Panels flow by `role = Panels` and ascending `sequence_order`.
- Magazine is a single station in the flow with `role = Magazine`.
- Assembly flow uses `role = Assembly` + same `line_type` + ascending `sequence_order`.
- AUX stations do not affect flow and can keep `sequence_order = NULL`.
