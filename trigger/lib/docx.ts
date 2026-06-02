// trigger/lib/docx.ts
// Converts markdown text to a DOCX buffer using the `docx` npm package.
// Handles: headings (H1–H3), bold/italic inline, bullet lists (nested),
// numbered lists, blockquotes, tables, horizontal rules, and paragraphs.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  LevelFormat,
  WidthType,
  ShadingType,
} from "docx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
}

type DocChild = Paragraph | Table;

// ---------------------------------------------------------------------------
// Inline parser: **bold**, *italic*, plain text
// ---------------------------------------------------------------------------

function parseInline(line: string): ParsedRun[] {
  const runs: ParsedRun[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (match[2]) {
      runs.push({ text: match[2], bold: true });
    } else if (match[3]) {
      runs.push({ text: match[3], italics: true });
    } else if (match[4]) {
      runs.push({ text: match[4] });
    }
  }
  return runs.length > 0 ? runs : [{ text: line }];
}

// ---------------------------------------------------------------------------
// Table parser
// Detects markdown table blocks (lines starting with |) and builds a docx Table.
// ---------------------------------------------------------------------------

// Content width for A4 with 1" margins = 11906 - 2880 = 9026 DXA
const CONTENT_WIDTH_DXA = 9026;

const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const TABLE_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
  insideHorizontal: TABLE_BORDER,
  insideVertical: TABLE_BORDER,
};
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidth = Math.floor(CONTENT_WIDTH_DXA / colCount);
  const colWidths = Array(colCount).fill(colWidth);

  const tableRows = rows.map((cells, rowIndex) =>
    new TableRow({
      tableHeader: rowIndex === 0,
      children: cells.map((cellText, colIndex) =>
        new TableCell({
          borders: TABLE_BORDERS,
          width: { size: colWidths[colIndex] ?? colWidth, type: WidthType.DXA },
          margins: CELL_MARGINS,
          shading:
            rowIndex === 0
              ? { fill: "E8F0F7", type: ShadingType.CLEAR }
              : undefined,
          children: [
            new Paragraph({
              children: parseInline(cellText.trim()).map(
                (r) => new TextRun({ ...r, bold: rowIndex === 0 ? true : r.bold })
              ),
            }),
          ],
        })
      ),
    })
  );

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: tableRows,
  });
}

// Parse a pipe-delimited markdown table line into cells
function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  // e.g. |---|---|---|
  return isTableRow(line) && /^\|[\s|:-]+\|$/.test(line.trim());
}

// ---------------------------------------------------------------------------
// Main markdown → Paragraph/Table converter
// ---------------------------------------------------------------------------

function mdToChildren(markdown: string): DocChild[] {
  const lines = markdown.split("\n");
  const children: DocChild[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // ── TABLE BLOCK ──────────────────────────────────────────────────────────
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i].trimEnd())) {
        tableLines.push(lines[i].trimEnd());
        i++;
      }
      // Filter out separator rows (|---|---|)
      const dataRows = tableLines.filter((l) => !isSeparatorRow(l));
      if (dataRows.length > 0) {
        children.push(buildTable(dataRows.map(parseTableRow)));
        // Add a small spacer after the table
        children.push(new Paragraph({ spacing: { after: 120 } }));
      }
      continue;
    }

    // ── HEADING 1 ─────────────────────────────────────────────────────────
    const h1 = line.match(/^# (.+)/);
    if (h1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(h1[1]).map((r) => new TextRun(r)),
        })
      );
      i++;
      continue;
    }

    // ── HEADING 2 ─────────────────────────────────────────────────────────
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(h2[1]).map((r) => new TextRun(r)),
        })
      );
      i++;
      continue;
    }

    // ── HEADING 3 ─────────────────────────────────────────────────────────
    const h3 = line.match(/^### (.+)/);
    if (h3) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInline(h3[1]).map((r) => new TextRun(r)),
        })
      );
      i++;
      continue;
    }

    // ── HORIZONTAL RULE ───────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      children.push(
        new Paragraph({
          border: {
            bottom: {
              color: "AAAAAA",
              space: 1,
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
          spacing: { after: 120 },
        })
      );
      i++;
      continue;
    }

    // ── BLOCKQUOTE ────────────────────────────────────────────────────────
    if (line.startsWith(">")) {
      const content = line.replace(/^>\s?/, "");
      children.push(
        new Paragraph({
          children: parseInline(content).map(
            (r) => new TextRun({ ...r, italics: true, color: "555555" })
          ),
          indent: { left: 720, right: 360 },
          border: {
            left: {
              color: "4472C4",
              space: 10,
              style: BorderStyle.SINGLE,
              size: 12,
            },
          },
          spacing: { before: 60, after: 60 },
        })
      );
      i++;
      continue;
    }

    // ── NUMBERED LIST ─────────────────────────────────────────────────────
    const numMatch = line.match(/^(\s*)(\d+)\. (.+)/);
    if (numMatch) {
      const indent = numMatch[1].length;
      const level = indent >= 4 ? 1 : 0;
      const content = numMatch[3];
      children.push(
        new Paragraph({
          numbering: { reference: "decimal-list", level },
          children: parseInline(content).map((r) => new TextRun(r)),
          spacing: { after: 40 },
        })
      );
      i++;
      continue;
    }

    // ── BULLET LIST (with nesting) ─────────────────────────────────────────
    const bulletMatch = line.match(/^(\s*)[-*] (.+)/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const level = indent >= 4 ? 1 : indent >= 2 ? 1 : 0;
      const content = bulletMatch[2];
      children.push(
        new Paragraph({
          numbering: { reference: "bullet-list", level },
          children: parseInline(content).map((r) => new TextRun(r)),
          spacing: { after: 40 },
        })
      );
      i++;
      continue;
    }

    // ── EMPTY LINE ────────────────────────────────────────────────────────
    if (line.trim() === "") {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      i++;
      continue;
    }

    // ── NORMAL PARAGRAPH ──────────────────────────────────────────────────
    children.push(
      new Paragraph({
        children: parseInline(line).map((r) => new TextRun(r)),
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80 },
      })
    );
    i++;
  }

  return children;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function markdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const doc = new Document({
    // ── Numbering (bullets + decimal lists) ────────────────────────────────
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
                run: { font: "Arial" },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "◦",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 1080, hanging: 360 } },
                run: { font: "Arial" },
              },
            },
          ],
        },
        {
          reference: "decimal-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
                run: { font: "Times New Roman" },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: "%2.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 1080, hanging: 360 } },
                run: { font: "Times New Roman" },
              },
            },
          ],
        },
      ],
    },

    // ── Styles ─────────────────────────────────────────────────────────────
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 }, // 12pt body
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 32,      // 16pt
            bold: true,
            color: "000000",
            allCaps: true,
          },
          paragraph: {
            spacing: { before: 360, after: 120 },
            outlineLevel: 0,
            alignment: AlignmentType.CENTER,
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 28,      // 14pt
            bold: true,
            color: "000000",
            underline: {},
          },
          paragraph: {
            spacing: { before: 240, after: 80 },
            outlineLevel: 1,
          },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 24,      // 12pt
            bold: true,
            italics: true,
            color: "000000",
          },
          paragraph: {
            spacing: { before: 160, after: 60 },
            outlineLevel: 2,
          },
        },
      ],
    },

    // ── Page layout ────────────────────────────────────────────────────────
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,   // A4
              height: 16838,
            },
            margin: {
              top: 1440,      // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: mdToChildren(markdown),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
