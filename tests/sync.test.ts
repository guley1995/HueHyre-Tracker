import { describe, expect, it } from "vitest";
import { parseCsv } from "../scripts/sync/sync";

describe("CSV aus dem Import-Ordner", () => {
  it("erkennt Semikolon/Komma, Anführungszeichen und BOM", () => {
    expect(parseCsv('﻿first_name;last_name;notes\nEva;"Muster; Jr.";"sagt ""hallo"""\n\n')).toEqual([
      { first_name: "Eva", last_name: "Muster; Jr.", notes: 'sagt "hallo"' },
    ]);
    expect(parseCsv("name,city\r\nKirstein,Freudenstadt\r\nSURTECO,\r\n")).toEqual([
      { name: "Kirstein", city: "Freudenstadt" }, { name: "SURTECO" },
    ]);
  });
});
