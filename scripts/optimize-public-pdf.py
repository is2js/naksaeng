"""Keep all visible PDF content; remove embedded Illustrator editing payloads.

The untouched official original must be retained outside the public repository.
Requires pypdf; the output is explicitly labelled as an optimized copy in the
document catalog. This is not a source for changing prices or contract terms.
"""
from argparse import ArgumentParser
from pathlib import Path
from pypdf import PdfReader, PdfWriter

parser = ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
if args.output.exists():
    parser.error("Refusing to overwrite an existing output PDF.")
args.output.parent.mkdir(parents=True, exist_ok=True)
original = PdfReader(args.source)
text = [page.extract_text() for page in original.pages]
writer = PdfWriter()
for page in original.pages:
    # Native authoring data/thumbnails are not part of the visible PDF. Remove
    # before cloning so unused 189MB editing streams never enter the writer.
    for key in ["/PieceInfo", "/Thumb"]:
        page.pop(key, None)
    writer.add_page(page)
writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
with args.output.open("wb") as stream:
    writer.write(stream)
optimized = PdfReader(args.output)
pages = len(original.pages)
assert len(optimized.pages) == pages
assert [page.extract_text() for page in optimized.pages] == text, "Text content must remain unchanged."
print(f"Optimized {pages} pages: {args.source.stat().st_size} -> {args.output.stat().st_size} bytes; text unchanged.")
