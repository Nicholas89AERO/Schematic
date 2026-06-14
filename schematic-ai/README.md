# SchematicAI

Aerospace electrical drawing intelligence platform.

Reads, creates, and modifies electrical drawings across three interlinked layers:

| Layer | Description |
|---|---|
| **L1 — Block Diagram** | System-level single-line diagram showing equipment blocks and signal/power paths |
| **L2 — Schematic** | Detailed interconnection drawing with full component-level wiring |
| **L3 — Harness** | Production packaging drawing with connectors, pin assignments, wire runs |

All three layers are linked bidirectionally with full cross-reference validation.

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- An Anthropic API key (for AI features)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Docker

```bash
cp backend/.env.example .env
# Edit .env with your ANTHROPIC_API_KEY
docker-compose up --build
```

---

## Usage

1. **Upload a drawing** — drag and drop a DXF, DWG, or PDF file into the sidebar. The system auto-detects the layer (L1/L2/L3). If confidence is below 80%, you are asked to confirm.

2. **Navigate layers** — use the **L1 / L2 / L3** tabs at the top. Click any element to drill into its linked layer:
   - Click a signal path in L1 → opens its L2 schematic sheet
   - Click a wire in L2 → highlights its L3 harness record
   - A breadcrumb trail tracks your navigation path

3. **AI modifications** — type natural language in the AI Chat panel. Changes propagate across layers automatically.

4. **Compliance check** — run the compliance engine from the Compliance tab. All rules (BD001–BD007, SCH001–SCH007, HRN001–HRN010, XL001–XL010) are checked and scored 0–100.

5. **Export** — click DXF, PDF, or Wire List in the toolbar to export the current layer.

---

## Architecture

```
schematic-ai/
├── backend/                 FastAPI backend
│   ├── models/              ProjectModel — single source of truth
│   ├── parsers/             DXF + PDF parsing (layer auto-detection)
│   ├── linkers/             Cross-reference builder
│   ├── validators/          Consistency checker
│   ├── exporters/           DXF R2018 + PDF writers
│   ├── ai/                  Claude API client + changeset applier
│   └── compliance/          BD / SCH / HRN / XL rules
└── frontend/                React 18 + TypeScript + Tailwind
    ├── src/canvas/          SVG renderers for all three layers
    ├── src/panels/          AI, Compliance, Diff, Consistency panels
    └── src/state/           Global app state (useReducer)
```

---

## Standards Implemented

- **ATA100 Chapter 20** — block diagram and schematic conventions
- **IEC 60617** — electrical symbol conventions
- **AS9100D / DO-160G / MIL-STD-454** — aerospace compliance rules
- **MIL-DTL-38999** — circular connector requirements
- **MIL-W-22759 (M22759)** — aerospace wire specification
- **IEC 60364-5-52** — current capacity vs wire gauge table (XL009)

---

## Environment Variables

```env
ANTHROPIC_API_KEY=your_key_here
ODA_CONVERTER_PATH=/usr/local/bin/ODAFileConverter   # optional: DWG → DXF
MAX_FILE_SIZE_MB=50
CORS_ORIGINS=http://localhost:5173
```

---

## DXF Output

All DXF files target **R2018** (`AC1032`). Compatible with AutoCAD 2018+ and SolidWorks Electrical 2020+. No AutoCAD or SolidWorks license required — all I/O is via `ezdxf`.

Coordinates are in **millimetres** throughout.
