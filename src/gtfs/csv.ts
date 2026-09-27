export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  const header = records.shift();
  if (!header?.length) throw new Error("CSV header is missing");
  return records.filter((row) => row.some(Boolean)).map((row) => {
    if (row.length !== header.length) throw new Error("CSV row has an unexpected column count");
    return Object.fromEntries(header.map((name, index) => [name.replace(/^\uFEFF/, ""), row[index] ?? ""]));
  });
}
