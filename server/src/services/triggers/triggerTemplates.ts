export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Prefer human-readable identity / shop / amount / date fields in alert emails. */
const EMAIL_FIELD_PRIORITY = [
  "shopName",
  "shopname",
  "branchName",
  "branch",
  "deviceName",
  "device",
  "totalAmount",
  "amount",
  "paidToCustomer",
  "sellAmount",
  "customerName",
  "modelName",
  "categoryName",
  "name",
  "title",
  "documentName",
  "fileName",
  "registrationNo",
  "invoiceNo",
  "imeiNo",
  "endDate",
  "expiresAt",
  "expiryDate",
  "validUntil",
  "dueDate",
  "startDate",
  "date",
  "status"
];

const FRIENDLY_LABELS: Record<string, string> = {
  shopName: "Shop",
  shopname: "Shop",
  branchName: "Shop",
  branch: "Shop",
  deviceName: "Device",
  device: "Device",
  totalAmount: "Amount",
  amount: "Amount",
  paidToCustomer: "Paid",
  sellAmount: "Sell amount",
  customerName: "Customer",
  modelName: "Model",
  categoryName: "Category",
  invoiceNo: "Invoice",
  imeiNo: "IMEI",
  endDate: "End date",
  expiresAt: "Expires",
  expiryDate: "Expiry",
  validUntil: "Valid until",
  dueDate: "Due date",
  startDate: "Start date",
  registrationNo: "Registration"
};

const SKIP_EMAIL_FIELDS = new Set([
  "_id",
  "id",
  "Id",
  "ID",
  "isDeleted",
  "isSelled",
  "outletDocument",
  "documents",
  "files",
  "attachments",
  "__v",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "companyId",
  "outletId",
  "documentFolderId",
  "organization",
  "upload",
  "generatedImage",
  "signatureImage",
  "payment",
  "websiteDetail",
  "termsConditionIds",
  "gst",
  "remainingAmount",
  "estimateSellPrice",
  "paymentType",
  "batteryHealth",
  "country",
  "warranty",
  "condition",
  "color",
  "capacityName",
  "srNo"
]);

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export type FormatRowsOptions = {
  /** When set, only these fields (plus aliases) are listed under each row. */
  displayFields?: string[];
};

/** Format all matching rows for alert emails (no “…and N more” truncation). */
export function formatRowsPreview(
  rows: Record<string, unknown>[],
  options?: FormatRowsOptions
): string {
  if (!rows.length) return "(no matching rows)";
  return rows
    .map((row, i) => {
      const title = pickTitle(row);
      const details = pickDetailLines(row, options?.displayFields);
      const body = details.length ? `\n   ${details.join("\n   ")}` : "";
      return `${i + 1}. ${title}${body}`;
    })
    .join("\n\n");
}

function friendlyLabel(key: string): string {
  return FRIENDLY_LABELS[key] ?? key;
}

function looksLikeObjectId(value: unknown): boolean {
  return typeof value === "string" && OBJECT_ID_RE.test(value.trim());
}

function pickTitle(row: Record<string, unknown>): string {
  const shop = firstString(row, ["shopName", "shopname", "branchName", "branch"]);
  const device = firstString(row, ["deviceName", "device"]);
  const amount = firstNumber(row, ["totalAmount", "amount", "paidToCustomer", "sellAmount"]);
  const amountPart = amount !== null ? ` — ${formatNumber(amount)}` : "";

  if (shop && device) return `${shop} / ${device}${amountPart}`;
  if (shop) return `${shop}${amountPart}`;
  if (device) return `Device ${device}${amountPart}`;

  for (const key of ["name", "title", "documentName", "fileName", "registrationNo", "customerName", "invoiceNo"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim() && !looksLikeObjectId(v)) return v.trim();
  }
  if (amount !== null) return `Amount ${formatNumber(amount)}`;
  return "Record";
}

function pickDetailLines(row: Record<string, unknown>, displayFields?: string[]): string[] {
  const lines: string[] = [];
  const used = new Set<string>();

  const keys = displayFields?.length
    ? expandDisplayFields(displayFields, row)
    : EMAIL_FIELD_PRIORITY;

  for (const key of keys) {
    if (used.has(key) || SKIP_EMAIL_FIELDS.has(key)) continue;
    if (!(key in row)) continue;
    const formatted = formatDetailValue(row[key]);
    if (!formatted) continue;
    lines.push(`${friendlyLabel(key)}: ${formatted}`);
    used.add(key);
    // Collapse shop aliases
    if (["shopName", "shopname", "branchName", "branch"].includes(key)) {
      used.add("shopName");
      used.add("shopname");
      used.add("branchName");
      used.add("branch");
    }
    if (["deviceName", "device"].includes(key)) {
      used.add("deviceName");
      used.add("device");
    }
    if (["totalAmount", "amount", "paidToCustomer", "sellAmount"].includes(key)) {
      used.add("totalAmount");
      used.add("amount");
      used.add("paidToCustomer");
      used.add("sellAmount");
    }
    if (!displayFields?.length && lines.length >= 6) break;
  }
  return lines;
}

/** Map user-facing names (shopname, amount) onto actual row keys. */
function expandDisplayFields(requested: string[], row: Record<string, unknown>): string[] {
  const aliases: Record<string, string[]> = {
    shop: ["shopName", "shopname", "branchName", "branch"],
    shopname: ["shopName", "shopname", "branchName", "branch"],
    shopName: ["shopName", "shopname", "branchName", "branch"],
    branch: ["branch", "branchName", "shopName", "shopname"],
    device: ["deviceName", "device"],
    devicename: ["deviceName", "device"],
    deviceName: ["deviceName", "device"],
    amount: ["totalAmount", "amount", "paidToCustomer", "sellAmount"],
    totalamount: ["totalAmount", "amount", "paidToCustomer", "sellAmount"],
    totalAmount: ["totalAmount", "amount", "paidToCustomer", "sellAmount"]
  };

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const key = raw.trim();
    if (!key) continue;
    const candidates = aliases[key] ?? aliases[key.toLowerCase()] ?? [key];
    for (const cand of candidates) {
      if (cand in row && !seen.has(cand)) {
        out.push(cand);
        seen.add(cand);
        break;
      }
    }
  }
  return out.length ? out : EMAIL_FIELD_PRIORITY;
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim() && !looksLikeObjectId(v)) return v.trim();
  }
  return null;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (looksLikeObjectId(trimmed)) return ""; // unresolved id — hide
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    if (trimmed.length > 120) return `${trimmed.slice(0, 117)}…`;
    return trimmed;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "";
    if (value.every((v) => typeof v === "string" && (/^https?:\/\//i.test(v) || v.includes("/")))) {
      return `${value.length} file(s)`;
    }
    return `${value.length} item(s)`;
  }
  return "";
}

export function rowIdentity(row: Record<string, unknown>): string {
  const id = row._id ?? row.id ?? row.Id ?? row.ID;
  if (id !== undefined && id !== null) return String(id);
  try {
    return JSON.stringify(row).slice(0, 120);
  } catch {
    return String(Math.random());
  }
}
