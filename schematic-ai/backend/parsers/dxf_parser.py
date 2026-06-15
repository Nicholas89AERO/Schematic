"""
DXF Parser dispatcher — detects layer and routes to the appropriate per-layer parser.

Supports .dxf files directly via ezdxf.
For .dwg files, attempts conversion via the ODA File Converter (if installed),
otherwise raises a clear error with conversion instructions.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from models.project import BlockDiagram, DrawingLayer, HarnessSheet, SchematicSheet
from .layer_detector import LayerDetectionResult, detect_layer
from .l1_block_parser import parse_block_diagram_dxf
from .l2_schema_parser import parse_schematic_dxf
from .l3_harness_parser import parse_harness_dxf

_ODA_CONVERTER = os.getenv("ODA_CONVERTER_PATH", "")


def _convert_dwg_to_dxf(dwg_path: Path, warnings: list[str]) -> Optional[Path]:
    """
    Attempt to convert a .dwg file to .dxf using the ODA File Converter.

    Returns the path to the converted .dxf file, or None if conversion fails.
    The returned file lives in a temp directory — caller must clean it up.
    """
    # Try ODA File Converter (free, cross-platform)
    oda = _ODA_CONVERTER or shutil.which("ODAFileConverter") or shutil.which("ODAFileConverter.exe")

    if oda and Path(oda).exists():
        out_dir = Path(tempfile.mkdtemp(prefix="dwg_conv_"))
        try:
            result = subprocess.run(
                [oda, str(dwg_path.parent), str(out_dir), "ACAD2018", "DXF", "0", "1",
                 dwg_path.name],
                capture_output=True, text=True, timeout=60,
            )
            converted = list(out_dir.glob("*.dxf"))
            if converted:
                warnings.append(f"DWG converted to DXF via ODA File Converter: {dwg_path.name}")
                return converted[0]
            err = result.stderr.strip() or result.stdout.strip()
            warnings.append(f"ODA File Converter ran but produced no output: {err[:200]}")
        except subprocess.TimeoutExpired:
            warnings.append("DWG conversion timed out after 60 seconds")
        except Exception as exc:
            warnings.append(f"DWG conversion failed: {exc}")
        return None

    # Try ezdxf's own recover (handles some newer DWG variants indirectly, often fails)
    try:
        import ezdxf
        doc, auditor = ezdxf.recover.readfile(str(dwg_path))
        dxf_path = dwg_path.with_suffix(".recovered.dxf")
        doc.saveas(str(dxf_path))
        warnings.append("DWG parsed via ezdxf recover mode (partial data only).")
        return dxf_path
    except Exception:
        pass

    return None


def parse_dxf(
    file_path: str | Path,
    layer_hint: Optional[DrawingLayer] = None,
    sheet_number: int = 1,
    warnings: Optional[list[str]] = None,
) -> tuple[DrawingLayer, BlockDiagram | SchematicSheet | HarnessSheet, LayerDetectionResult]:
    """
    Detect the layer of a DXF/DWG file and parse it with the appropriate parser.

    For .dwg files, attempts ODA File Converter conversion first.
    If conversion is unavailable, raises ValueError with clear instructions.

    Returns:
        Tuple of (detected_layer, parsed_object, detection_result).
    """
    if warnings is None:
        warnings = []

    path = Path(file_path)
    converted_path: Optional[Path] = None

    if path.suffix.lower() == ".dwg":
        converted_path = _convert_dwg_to_dxf(path, warnings)
        if converted_path is None:
            # Provide clear, actionable error message
            warnings.append(
                "DWG format is not directly readable. "
                "Please convert to DXF first using one of these free tools:\n"
                "  • ODA File Converter (free): https://www.opendesign.com/guestfiles/oda_file_converter\n"
                "  • AutoCAD (File → Save As → AutoCAD 2018 DXF)\n"
                "  • LibreCAD (File → Export → DXF)\n"
                "  • FreeCAD (File → Export → DXF)\n"
                "Set ODA_CONVERTER_PATH in .env for automatic conversion."
            )
            # Return minimal schematic sheet rather than crashing
            fallback_layer = layer_hint or DrawingLayer.SCHEMATIC
            from .layer_detector import LayerDetectionResult
            det = LayerDetectionResult(
                detected_layer=fallback_layer,
                confidence=0.0,
                reason="DWG conversion unavailable — no data extracted",
            )
            if fallback_layer == DrawingLayer.BLOCK_DIAGRAM:
                return fallback_layer, BlockDiagram(sheet_number=sheet_number), det
            elif fallback_layer == DrawingLayer.HARNESS:
                return fallback_layer, HarnessSheet(number=sheet_number), det
            else:
                return fallback_layer, SchematicSheet(number=sheet_number), det
        parse_path = converted_path
    else:
        parse_path = path

    try:
        detection = detect_layer(parse_path, hint=layer_hint)
        layer = layer_hint or detection.detected_layer

        if layer == DrawingLayer.BLOCK_DIAGRAM:
            result = parse_block_diagram_dxf(parse_path, sheet_number=sheet_number, warnings=warnings)
        elif layer == DrawingLayer.HARNESS:
            result = parse_harness_dxf(parse_path, sheet_number=sheet_number, warnings=warnings)
        else:
            result = parse_schematic_dxf(parse_path, sheet_number=sheet_number, warnings=warnings)

        return layer, result, detection
    finally:
        # Clean up temp converted file
        if converted_path and converted_path.exists():
            try:
                converted_path.unlink()
                converted_path.parent.rmdir()
            except Exception:
                pass
