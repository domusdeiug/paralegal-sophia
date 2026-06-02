// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "./cors.ts";
import { requireUser, callOpenRouter } from "./auth.ts";

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function countBy(rows: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = r[key] ?? "Unknown";
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function statsBlock(cases: any[], startDate: string, endDate: string): string {
  const total = cases.length;
  const bySex = countBy(cases, "sex");
  const byNature = countBy(cases, "nature_of_case");
  const byVuln = countBy(cases, "vulnerability");
  const byStatus = countBy(cases, "status");
  const byOldNew = countBy(cases, "old_new");

  const fmt = (obj: Record<string, number>) =>
    Object.entries(obj)
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");

  return `PERIOD: ${startDate} to ${endDate}
TOTAL CASES: ${total}

BY SEX:
${fmt(bySex)}

BY NATURE OF CASE:
${fmt(byNature)}

BY CLIENT VULNERABILITY:
${fmt(byVuln)}

BY STATUS:
${fmt(byStatus)}

BY CLIENT TYPE (Old/New):
${fmt(byOldNew)}`;
}

// ---------------------------------------------------------------------------
// Minimal .docx builder (Deno-compatible, no npm deps)
// ---------------------------------------------------------------------------

class ZipWriter {
  private entries: { name: string; data: Uint8Array }[] = [];

  add(name: string, data: string | Uint8Array) {
    this.entries.push({
      name,
      data: typeof data === "string" ? new TextEncoder().encode(data) : data,
    });
  }

  build(): Uint8Array {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const centralDir: Uint8Array[] = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBytes = enc.encode(entry.name);
      const crc = crc32(entry.data);
      const size = entry.data.length;

      const local = new DataView(new ArrayBuffer(30 + nameBytes.length));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, 0, true);
      local.setUint16(12, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      new Uint8Array(local.buffer).set(nameBytes, 30);

      const localBytes = new Uint8Array(local.buffer);
      parts.push(localBytes);
      parts.push(entry.data);

      const cd = new DataView(new ArrayBuffer(46 + nameBytes.length));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true);
      cd.setUint16(14, 0, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(40, 0x20, true);
      cd.setUint32(42, offset, true);
      new Uint8Array(cd.buffer).set(nameBytes, 46);
      centralDir.push(new Uint8Array(cd.buffer));

      offset += localBytes.length + size;
    }

    const cdBytes = concat(centralDir);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, this.entries.length, true);
    eocd.setUint16(10, this.entries.length, true);
    eocd.setUint32(12, cdBytes.length, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    return concat([...parts, cdBytes, new Uint8Array(eocd.buffer)]);
  }
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) { out.set(a, pos); pos += a.length; }
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Convert inline markdown to Word runs: **bold**, *italic*, stripped backticks
function runsFromLine(raw: string): string {
  // Remove single-backtick code spans (just show the text)
  let line = raw.replace(/`([^`]+)`/g, "$1");
  // Process **bold** and *italic* interleaved
  // Strategy: tokenise by **...** first, then *...* within non-bold segments
  const boldParts = line.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.map((seg, bi) => {
    if (bi % 2 === 1) {
      // Bold segment
      const inner = xmlEsc(seg.slice(2, -2));
      return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${inner}</w:t></w:r>`;
    }
    // Within non-bold, handle *italic*
    const italicParts = seg.split(/(\*[^*]+\*)/g);
    return italicParts.map((s, ii) => {
      if (ii % 2 === 1) {
        const inner = xmlEsc(s.slice(1, -1));
        return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${inner}</w:t></w:r>`;
      }
      return s ? `<w:r><w:t xml:space="preserve">${xmlEsc(s)}</w:t></w:r>` : "";
    }).join("");
  }).join("");
}

// ---------------------------------------------------------------------------
// Table builder — parses a block of markdown table lines into <w:tbl> XML
// ---------------------------------------------------------------------------

const TABLE_BORDER = `<w:top w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
              <w:left w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
              <w:bottom w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
              <w:right w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
              <w:insideH w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
              <w:insideV w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>`;

function buildTableXml(tableLines: string[]): string {
  // Filter out separator lines (e.g. |---|---|)
  const dataLines = tableLines.filter(l => !l.replace(/[|:\-\s]/g, "").length === false
    ? true
    : !/^[|:\-\s]+$/.test(l)
  );

  const rows = dataLines.map(l => {
    // Split on | and trim, ignoring leading/trailing empty cells
    const cells = l.split("|").map(c => c.trim());
    // Remove first/last if empty (from leading/trailing |)
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    return cells;
  });

  if (rows.length === 0) return "";

  const xmlRows = rows.map((cells, rowIdx) => {
    const isHeader = rowIdx === 0;
    const xmlCells = cells.map(cell => {
      const shading = isHeader
        ? `<w:shd w:val="clear" w:color="auto" w:fill="2E4057"/>`
        : `<w:shd w:val="clear" w:color="auto" w:fill="auto"/>`;
      const rPr = isHeader
        ? `<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>`
        : `<w:rPr></w:rPr>`;
      return `<w:tc>
          <w:tcPr>
            <w:tcBorders>${TABLE_BORDER}</w:tcBorders>
            ${shading}
            <w:tcMar>
              <w:top w:w="80" w:type="dxa"/>
              <w:left w:w="115" w:type="dxa"/>
              <w:bottom w:w="80" w:type="dxa"/>
              <w:right w:w="115" w:type="dxa"/>
            </w:tcMar>
          </w:tcPr>
          <w:p><w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(cell)}</w:t></w:r></w:p>
        </w:tc>`;
    }).join("\n");
    return `<w:tr>${xmlCells}</w:tr>`;
  }).join("\n");

  return `<w:tbl>
  <w:tblPr>
    <w:tblStyle w:val="TableGrid"/>
    <w:tblW w:w="0" w:type="auto"/>
    <w:tblBorders>${TABLE_BORDER}</w:tblBorders>
    <w:tblCellMar>
      <w:top w:w="80" w:type="dxa"/>
      <w:left w:w="115" w:type="dxa"/>
      <w:bottom w:w="80" w:type="dxa"/>
      <w:right w:w="115" w:type="dxa"/>
    </w:tblCellMar>
  </w:tblPr>
  ${xmlRows}
</w:tbl>
<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`;
}

// ---------------------------------------------------------------------------
// Main markdown → Word XML converter
// Handles: headings, bullets, numbered lists, tables, bold, italic, hr, blank lines
// ---------------------------------------------------------------------------

function buildDocXml(text: string): string {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const elements: string[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i].trimEnd();

    // --- Markdown table: collect contiguous table lines ---
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < rawLines.length && rawLines[i].trimEnd().startsWith("|")) {
        tableLines.push(rawLines[i].trimEnd());
        i++;
      }
      elements.push(buildTableXml(tableLines));
      continue;
    }

    // --- Horizontal rule ---
    if (/^[-*_]{3,}$/.test(line.trim())) {
      elements.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr></w:pPr></w:p>`);
      i++;
      continue;
    }

    // --- Headings ---
    if (line.startsWith("### ")) {
      elements.push(`<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>${runsFromLine(line.slice(4))}</w:p>`);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      elements.push(`<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${runsFromLine(line.slice(3))}</w:p>`);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      elements.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runsFromLine(line.slice(2))}</w:p>`);
      i++; continue;
    }

    // --- Bullet list ---
    if (/^[-*] /.test(line)) {
      elements.push(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${runsFromLine(line.slice(2))}</w:p>`);
      i++; continue;
    }

    // --- Numbered list ---
    if (/^\d+[.)\s]/.test(line)) {
      const content = line.replace(/^\d+[.)\s]+/, "");
      elements.push(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${runsFromLine(content)}</w:p>`);
      i++; continue;
    }

    // --- Blank line ---
    if (line === "") {
      elements.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`);
      i++; continue;
    }

    // --- Normal paragraph ---
    elements.push(`<w:p>${runsFromLine(line)}</w:p>`);
    i++;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${elements.join("\n")}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
</w:sectPr>
</w:body>
</w:document>`;
}

function buildDocx(text: string): Uint8Array {
  const zip = new ZipWriter();

  zip.add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`
  );

  zip.add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.add("word/document.xml", buildDocXml(text));

  zip.add(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`
  );

  zip.add(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
      <w:sz w:val="24"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="2E4057"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="048A81"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:sz w:val="24"/><w:color w:val="333333"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720"/></w:pPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`
  );

  zip.add(
    "word/numbering.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
  );

  return zip.build();
}

// ---------------------------------------------------------------------------
// Extract readable text from a stored sample document
// ---------------------------------------------------------------------------

async function extractSampleText(supabase: any, userId: string, kind: string): Promise<string> {
  const { data: doc } = await supabase
    .from("user_documents")
    .select("storage_path, file_name, mime_type")
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc) return "";

  const { data: file } = await supabase.storage
    .from("user-documents")
    .download(doc.storage_path);
  if (!file) return "";

  const name: string = (doc.file_name ?? "").toLowerCase();
  const mime: string = (doc.mime_type ?? "").toLowerCase();

  if (mime.includes("text") || name.endsWith(".txt") || name.endsWith(".md")) {
    try { return await file.text(); } catch { return ""; }
  }

  if (name.endsWith(".docx") || mime.includes("wordprocessingml") || mime.includes("openxmlformats")) {
    try {
      const buf = await file.arrayBuffer();
      const text = await extractDocxText(buf);
      return text.slice(0, 6000);
    } catch { return ""; }
  }

  return `[Sample document: ${doc.file_name} — upload a .txt or .docx for best results]`;
}

async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const enc = new TextEncoder();
  const target = enc.encode("word/document.xml");

  let pos = 0;
  while (pos < bytes.length - 30) {
    if (bytes[pos] === 0x50 && bytes[pos + 1] === 0x4b && bytes[pos + 2] === 0x03 && bytes[pos + 3] === 0x04) {
      const nameLen = bytes[pos + 26] | (bytes[pos + 27] << 8);
      const extraLen = bytes[pos + 28] | (bytes[pos + 29] << 8);
      const compSize = bytes[pos + 18] | (bytes[pos + 19] << 8) | (bytes[pos + 20] << 16) | (bytes[pos + 21] << 24);
      const nameStart = pos + 30;
      const nameBytes = bytes.slice(nameStart, nameStart + nameLen);

      if (nameBytes.length === target.length && nameBytes.every((b, i) => b === target[i])) {
        const dataStart = nameStart + nameLen + extraLen;
        const xmlBytes = bytes.slice(dataStart, dataStart + compSize);
        const xml = new TextDecoder().decode(xmlBytes);
        return xml
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s{2,}/g, " ")
          .trim();
      }
      pos = nameStart + nameLen + extraLen + compSize;
    } else {
      pos++;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function monthlyReportPrompt(stats: string, sample: string): string {
  return `You are a legal aid lawyer writing a MONTHLY/QUARTERLY NARRATIVE REPORT for your supervising organisation (e.g. UNODC, LAC, or a similar donor/oversight body).

Write a complete, professional report using the statistics below. The report must include these sections in order:
1. Introduction (brief narrative of the period — what was the general focus, any notable context)
2. Activities / Outputs Completed (describe each activity type: mediations, reconciliations, prison visits, outreach, court appearances, bail applications, plea bargains — use the case statistics to give numbers; write in narrative paragraphs with embedded figures, not just bullet lists)
3. Statistics Summary (present as a markdown table with columns: Category | Breakdown | Count)
4. Progress Towards Outcomes (what changed, what improved, evidence of impact)
5. Challenges (honest account of difficulties faced)
6. Planned Activities for Next Period
7. Any Other Comments

Formatting rules (follow exactly):
- Use # for section headings, ## for sub-headings
- Use **bold** for emphasis on key terms or numbers
- Use - for bullet lists
- For the Statistics Summary, use a proper markdown table (| Col | Col | format)
- Do NOT output any raw markdown syntax as visible text — all formatting must be semantic
- Do not use underscores for emphasis; use ** only
- Do not use horizontal rules (---)

Write in formal but clear English, first person singular ("I attended...", "During this period I handled...").
Do not invent specific names, case numbers, or dates not present in the statistics.

=== STATISTICS ===
${stats}

=== STYLE REFERENCE (from user's own past reports — match this tone and structure) ===
${sample || "[No sample uploaded — use professional legal aid report style]"}

Write the full report now:`;
}

function activityReportPrompt(cases: any[], startDate: string, endDate: string, sample: string): string {
  const caseTable = cases
    .map(
      (c) =>
        `- ${c.client_name}, ${c.sex ?? "?"}, Age ${c.age ?? "?"}, ${c.nature_of_case ?? "?"}, ${c.vulnerability ?? ""}, Action: ${c.action_taken ?? ""}, Status: ${c.status ?? ""}`
    )
    .join("\n");

  return `You are a legal aid lawyer writing an ACTIVITY REPORT covering the period ${startDate} to ${endDate}.

This is a field activity / outreach report (e.g. a prison visit, remand home visit, or community outreach). It should read like a professional field report submitted to management or a donor.

Write a complete report with these sections:
1. Introduction (purpose and scope of the activities during this period)
2. Objective (what was the goal of the activities)
3. Activities Conducted (describe what was done — visits, interviews, follow-ups, hearings attended; group similar activities together)
4. Challenges Faced (practical and systemic issues encountered)
5. Recommendations (concrete actions for follow-up or systemic improvement)
6. List of Clients / Cases Seen (present as a markdown table: | # | Name | Sex | Age | Nature of Case | Vulnerability | Action Taken | Status |)
7. Next Steps

Formatting rules (follow exactly):
- Use # for section headings, ## for sub-headings
- Use **bold** for key terms
- Use - for bullet lists
- For the client list, use a proper markdown table (| Col | Col | format)
- Do NOT output any raw markdown syntax as visible text
- Do not use underscores for emphasis; use ** only
- Do not use horizontal rules (---)

Write in formal English, first person ("I conducted...", "During the visit...").
Use the actual client data provided — do not invent names or details.

=== CLIENT DATA (${cases.length} entries, ${startDate} to ${endDate}) ===
${caseTable || "[No cases found for this period]"}

=== STYLE REFERENCE ===
${sample || "[No sample uploaded — use professional legal aid field report style]"}

Write the full report now:`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateReport(
  req: Request,
  sampleKind: string,
  reportLabel: string
) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { supabase, user } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { from, to, month } = body as { from?: string; to?: string; month?: string };

    let startDate = from;
    let endDate = to;

    if (month) {
      const [y, m] = month.split("-").map(Number);
      startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = new Date(y, m, 0);
      endDate = end.toISOString().slice(0, 10);
    }

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: "from/to or month required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cases, error } = await supabase
      .from("cases")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });
    if (error) throw error;

    const sample = await extractSampleText(supabase, user.id, sampleKind);

    const isMonthly = sampleKind === "monthly_report";
    const prompt = isMonthly
      ? monthlyReportPrompt(statsBlock(cases ?? [], startDate, endDate), sample)
      : activityReportPrompt(cases ?? [], startDate, endDate, sample);

    const reportText = await callOpenRouter(
      [
        {
          role: "system",
          content: `You produce formal legal aid ${reportLabel}s for a Ugandan legal aid clinic. Follow the structure and formatting rules in the prompt exactly. Never output raw markdown symbols as visible text in running prose.`,
        },
        { role: "user", content: prompt },
      ],
      "deepseek/deepseek-v4-flash"
    );

    const docxBytes = buildDocx(reportText);
    const slug = reportLabel.toLowerCase().replace(/\s+/g, "_");
    const filename = `${slug}_${startDate}_to_${endDate}.docx`;

    return new Response(docxBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof Response)
      return new Response(e.body, { status: e.status, headers: corsHeaders });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
