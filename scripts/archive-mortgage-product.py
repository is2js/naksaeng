"""Archive the authorized seven-page scan; publish only a pixel-redacted copy.

Dependencies: reportlab, Pillow, PyMuPDF. Raw ZIP/private output stay outside the
repository. Do not use this tool for supply contracts or other signed documents.
"""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pymupdf
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--private-output", required=True, type=Path)
    parser.add_argument("--public-output", required=True, type=Path)
    args = parser.parse_args()
    if args.private_output.resolve() == args.public_output.resolve():
        parser.error("Private and public archives must be separate files.")
    for output in [args.private_output, args.public_output]:
        if output.exists():
            parser.error("Refusing to overwrite an existing archive: " + str(output))
        output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.zip) as archive:
        names = [f"page_{number:04}.jpg" for number in range(1, 8)]
        if sorted(archive.namelist()) != names:
            raise ValueError("Expected exactly seven sequential JPEG scans.")
        pdf = canvas.Canvas(str(args.private_output), pagesize=A4, pageCompression=1, invariant=1)
        pdf.setTitle("Dedicated shared-appreciation mortgage product - original private scan")
        pdf.setAuthor("")
        for name in names:
            image_bytes = archive.read(name)
            with Image.open(BytesIO(image_bytes)) as image:
                width, height = image.size
            scale = min(A4[0] / width, A4[1] / height)
            w, h = width * scale, height * scale
            pdf.drawImage(ImageReader(BytesIO(image_bytes)), (A4[0] - w) / 2, (A4[1] - h) / 2, w, h)
            pdf.showPage()
        pdf.save()

    with pymupdf.open(args.private_output) as document:
        page = document[3]
        w, h = page.rect.width, page.rect.height
        # Whole customer-acknowledgement area only. All financial clauses above
        # it remain. Actual pixels are erased, not merely covered by an overlay.
        rectangle = pymupdf.Rect(w * 0.08, h * 0.835, w * 0.97, h * 0.965)
        page.add_redact_annot(rectangle, fill=(1, 1, 1))
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS)
        page.insert_text((w * 0.12, h * 0.875), "PUBLIC ARCHIVE: personal acknowledgement/signature removed.", fontsize=8)
        page.insert_text((w * 0.12, h * 0.895), "Financial terms and annexes are unchanged; seven scanned pages retained.", fontsize=8)
        document.set_metadata({"title": "Dedicated mortgage product - public redacted scan", "author": "", "subject": "Personal acknowledgement on page 4 removed; no supply contracts included."})
        document.save(args.public_output, garbage=4, deflate=True, clean=True)
    with pymupdf.open(args.public_output) as public:
        assert len(public) == 7
        assert not list(public[3].annots() or []), "Redaction annotations must be applied, not left as covers."
    print("Created private original and public pixel-redacted seven-page PDFs.")


if __name__ == "__main__":
    main()
