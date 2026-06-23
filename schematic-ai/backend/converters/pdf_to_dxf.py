# -*- coding: utf-8 -*-
"""PDF-to-DXF converter (ASCII-safe source)."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Optional

_BEZIER_STEPS = 8


def _cubic_bezier_points(p0, p1, p2, p3, steps=_BEZIER_STEPS):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3*p0[0] + 3*mt**2*t*p1[0] + 3*mt*t**2*p2[0] + t**3*p3[0]
        y = mt**3*p0[1] + 3*mt**2*t*p1[1] + 3*mt*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts


def _quad_bezier_points(p0, p1, p2, steps=_BEZIER_STEPS):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**2*p0[0] + 2*mt*t*p1[0] + t**2*p2[0]
        y = mt**2*p0[1] + 2*mt*t*p1[1] + t**2*p2[1]
        pts.append((x, y))
    return pts


def _flip_y(x, y, page_height):
    return x, page_height - y


def _pt(obj):
    """Return (x, y) from a fitz Point, Quad, or 2-tuple."""
    if hasattr(obj, "x") and hasattr(obj, "y"):
        return float(obj.x), float(obj.y)
    if hasattr(obj, "ul"):
        # Quad: use upper-left corner as representative point
        p = obj.ul
        return float(p.x), float(p.y)
    try:
        return float(obj[0]), float(obj[1])
    except Exception:
        raise TypeError("Cannot extract point from {}".format(type(obj)))


def _path_to_entities(path, layer_name, page_height, msp, ezdxf_mod):
    color = 7
    items = path.get("items", [])
    poly_pts = []

    def flush_poly():
        if len(poly_pts) >= 2:
            pts3d = [(x, y, 0) for x, y in poly_pts]
            if len(pts3d) == 2:
                msp.add_line(pts3d[0], pts3d[1],
                             dxfattribs={"layer": layer_name, "color": color})
            else:
                msp.add_lwpolyline(pts3d,
                                   dxfattribs={"layer": layer_name, "color": color})
        poly_pts.clear()

    for item in items:
        try:
            kind = item[0]

            if kind == "l":
                x0, y0 = _flip_y(*_pt(item[1]), page_height)
                x1, y1 = _flip_y(*_pt(item[2]), page_height)
                if poly_pts and (x0, y0) != poly_pts[-1]:
                    flush_poly()
                if not poly_pts:
                    poly_pts.append((x0, y0))
                poly_pts.append((x1, y1))

            elif kind == "c":
                flush_poly()
                p0 = _pt(item[1])
                p1 = _pt(item[2])
                p2 = _pt(item[3])
                p3 = _pt(item[4])
                pts = _cubic_bezier_points(p0, p1, p2, p3)
                dxf_pts = [_flip_y(px, py, page_height) for px, py in pts]
                msp.add_lwpolyline([(x, y, 0) for x, y in dxf_pts],
                                   dxfattribs={"layer": layer_name, "color": color})

            elif kind == "qu":
                flush_poly()
                shape = item[1]
                if len(item) == 2 and hasattr(shape, "ul"):
                    # fitz Quad with 4 corners
                    corners = [
                        (*_flip_y(*_pt(shape.ul), page_height), 0),
                        (*_flip_y(*_pt(shape.ur), page_height), 0),
                        (*_flip_y(*_pt(shape.lr), page_height), 0),
                        (*_flip_y(*_pt(shape.ll), page_height), 0),
                    ]
                    msp.add_lwpolyline(corners, close=True,
                                       dxfattribs={"layer": layer_name, "color": color})
                elif len(item) >= 4:
                    p0 = _pt(item[1])
                    p1 = _pt(item[2])
                    p2 = _pt(item[3])
                    pts = _quad_bezier_points(p0, p1, p2)
                    dxf_pts = [_flip_y(px, py, page_height) for px, py in pts]
                    msp.add_lwpolyline([(x, y, 0) for x, y in dxf_pts],
                                       dxfattribs={"layer": layer_name, "color": color})

            elif kind == "re":
                flush_poly()
                shape = item[1]
                if hasattr(shape, "x0"):
                    x0, y0 = _flip_y(shape.x0, shape.y0, page_height)
                    x1, y1 = _flip_y(shape.x1, shape.y1, page_height)
                    corners = [(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)]
                elif hasattr(shape, "ul"):
                    corners = [
                        (*_flip_y(*_pt(shape.ul), page_height), 0),
                        (*_flip_y(*_pt(shape.ur), page_height), 0),
                        (*_flip_y(*_pt(shape.lr), page_height), 0),
                        (*_flip_y(*_pt(shape.ll), page_height), 0),
                    ]
                else:
                    continue
                msp.add_lwpolyline(corners, close=True,
                                   dxfattribs={"layer": layer_name, "color": color})

        except (AttributeError, TypeError, IndexError, ValueError):
            # Skip malformed path items; geometry extraction is best-effort.
            pass

    flush_poly()


def convert_pdf_to_dxf(
    pdf_path,
    output_path=None,
    warnings=None,
):
    """
    Convert a PDF file to a DXF R2018 file.

    Returns the path to the generated DXF file.
    """
    if warnings is None:
        warnings = []

    try:
        import fitz
    except ImportError as exc:
        raise ImportError(
            "PyMuPDF (fitz) is required. Install: pip install pymupdf"
        ) from exc

    try:
        import ezdxf
        from ezdxf import units
    except ImportError as exc:
        raise ImportError(
            "ezdxf is required. Install: pip install ezdxf"
        ) from exc

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError("PDF not found: {}".format(pdf_path))

    if output_path is None:
        output_path = pdf_path.with_suffix(".dxf")
    output_path = Path(output_path)

    doc = fitz.open(str(pdf_path))
    dxf = ezdxf.new("R2018")
    dxf.units = units.MM
    msp = dxf.modelspace()

    y_offset = 0.0

    for page_index, page in enumerate(doc):
        page_num = page_index + 1
        layer_name = "PAGE_{}".format(page_num)
        dxf.layers.new(layer_name)

        pw = page.rect.width
        ph = page.rect.height

        drawings = page.get_drawings()
        n_paths = 0
        for path in drawings:
            try:
                _path_to_entities(path, layer_name, ph, msp, ezdxf)
            except Exception:
                pass
            n_paths += 1

        words = page.get_text("words")
        n_text = 0
        for w in words:
            try:
                x0, y0, x1, y1, word = w[0], w[1], w[2], w[3], w[4]
                cx = (x0 + x1) / 2
                cy_pdf = (y0 + y1) / 2
                cx_dxf, cy_dxf = _flip_y(cx, cy_pdf, ph)
                height = max(abs(y1 - y0) * 0.65, 1.5)
                msp.add_text(
                    word,
                    dxfattribs={
                        "layer": layer_name,
                        "height": height,
                        "insert": (cx_dxf, cy_dxf + y_offset),
                        "halign": 1,
                    },
                )
                n_text += 1
            except Exception:
                pass

        if n_paths == 0 and n_text == 0:
            warnings.append(
                "Page {}: no vector paths or text found - "
                "the page may be a raster image.".format(page_num)
            )

        y_offset += ph * 0.353 + 30

    doc.close()
    dxf.saveas(str(output_path))
    return output_path


def convert_dwg_to_dxf(
    dwg_path,
    output_path=None,
    warnings=None,
):
    """
    Convert a DWG file to DXF using ODA File Converter or ezdxf recover.
    """
    import shutil
    import subprocess
    import tempfile
    import os

    if warnings is None:
        warnings = []

    dwg_path = Path(dwg_path)
    if not dwg_path.exists():
        raise FileNotFoundError("DWG not found: {}".format(dwg_path))

    if output_path is None:
        output_path = dwg_path.with_suffix(".dxf")
    output_path = Path(output_path)

    oda = (
        os.getenv("ODA_CONVERTER_PATH", "")
        or shutil.which("ODAFileConverter")
        or shutil.which("ODAFileConverter.exe")
        or ""
    )
    if oda and Path(oda).exists():
        out_dir = Path(tempfile.mkdtemp(prefix="dwg_conv_"))
        try:
            subprocess.run(
                [oda, str(dwg_path.parent), str(out_dir),
                 "ACAD2018", "DXF", "0", "1", dwg_path.name],
                capture_output=True, text=True, timeout=120,
                check=False,
            )
            converted = list(out_dir.glob("*.dxf"))
            if converted:
                shutil.copy2(converted[0], output_path)
                warnings.append(
                    "Converted via ODA File Converter: {}".format(dwg_path.name)
                )
                return output_path
            warnings.append("ODA File Converter ran but produced no output.")
        except subprocess.TimeoutExpired:
            warnings.append("ODA conversion timed out.")
        except Exception as exc:
            warnings.append("ODA conversion error: {}".format(exc))

    try:
        import ezdxf
        doc, _ = ezdxf.recover.readfile(str(dwg_path))
        doc.saveas(str(output_path))
        warnings.append(
            "Converted via ezdxf recover mode (partial data - "
            "install ODA File Converter for full fidelity)."
        )
        return output_path
    except Exception as exc:
        raise RuntimeError(
            "DWG conversion failed. Neither ODA File Converter nor ezdxf recover "
            "could read '{}'. "
            "Download ODA File Converter from "
            "https://www.opendesign.com/guestfiles/oda_file_converter "
            "and set ODA_CONVERTER_PATH in the backend .env. "
            "ezdxf error: {}".format(dwg_path.name, exc)
        ) from exc
