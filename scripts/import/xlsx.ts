// Excel lesen: Blätter mit Kopfzeile → Zeilen als { Spaltenname: Wert }.
import ExcelJS from "exceljs";

export type Cell = string | number | boolean | Date | null;
export type SheetRow = { __row: number } & Record<string, Cell>;
export type Sheet = { name: string; headers: string[]; rows: SheetRow[] };

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ("error" in v) return null;
    return String(v);
  }
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  return v as Cell;
}

/** Kopfzeile = erste Zeile (unter den ersten 8) mit mindestens 2 Text-Zellen. */
export async function readWorkbook(path: string): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    let headerRow = 0;
    let headers: string[] = [];
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const vals: string[] = [];
      ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = String(cellValue(c.value) ?? "").trim(); });
      if (vals.filter((v) => v && Number.isNaN(Number(v))).length >= 2) {
        headerRow = r;
        headers = vals.map((h, i) => h || `Spalte ${i + 1}`);
        break;
      }
    }
    const rows: SheetRow[] = [];
    if (headerRow) {
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const obj: SheetRow = { __row: r };
        let any = false;
        headers.forEach((h, i) => {
          const v = cellValue(row.getCell(i + 1).value);
          obj[h] = v;
          if (v !== null) any = true;
        });
        if (any) rows.push(obj);
      }
    }
    sheets.push({ name: ws.name, headers, rows });
  });
  return sheets;
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Blatt per Name finden (unscharf: Groß/Klein, Umlaute, Zusätze in Klammern). */
export function findSheet(sheets: Sheet[], ...names: string[]): Sheet | undefined {
  for (const n of names) {
    const k = norm(n);
    const hit = sheets.find((s) => norm(s.name) === k) ?? sheets.find((s) => norm(s.name).startsWith(k));
    if (hit) return hit;
  }
  return undefined;
}

/** Spalte über Aliasse finden; liefert den echten Spaltennamen. */
export function findColumn(headers: string[], aliases: string[]): string | undefined {
  const hs = headers.map((h) => ({ h, n: norm(h) }));
  for (const a of aliases) {
    const k = norm(a);
    const exact = hs.find((x) => x.n === k);
    if (exact) return exact.h;
  }
  for (const a of aliases) {
    const k = norm(a);
    const part = hs.find((x) => x.n.startsWith(k) || (k.length >= 4 && x.n.includes(k)));
    if (part) return part.h;
  }
  return undefined;
}
