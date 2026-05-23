/**
 * info-contracts.js
 *
 * Read-only coding contract inventory.
 *
 * Purpose:
 *   - Find live .cct files across the network.
 *   - Prefer contracts found on home.
 *   - De-duplicate by file name + contract data signature.
 *   - Avoid ns.getFileSize(), because it is not reliable/available here.
 *   - Ignore invalid pseudo-hosts such as ".".
 *   - Validate contracts using ns.codingcontract calls.
 *   - Write a compact JSON report.
 *   - Do not attempt solves.
 *
 * Usage:
 *   run info-contracts.js
 *   run info-contracts.js silent
 *   run info-contracts.js 50
 *
 * Output:
 *   /data/manager/contracts.json
 *
 * Args:
 *   0 modeOrLimit:
 *       "silent" = no tail output
 *       number   = visible row limit
 *   1 limit:
 *       row limit if arg0 is silent
 *
 * De-duplication:
 *   Primary key:
 *     fileName + contractType + dataSignature
 *
 * Preference order:
 *   1. Valid contract on home
 *   2. Valid contract on non-home
 *   3. Invalid file on home
 *   4. Invalid file on non-home
 *   5. Higher tries remaining
 *   6. Lexicographic server/file order
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const arg0 = String(ns.args[0] || "");
    const silent = arg0.toLowerCase() === "silent";
    const limit = silent ? num(ns.args[1], 50) : num(ns.args[0], 50);

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1180, 720);
    }

    const servers = scanAll(ns);
    const rawRows = [];

    for (const server of servers) {
        if (!isValidHost(ns, server)) continue;

        const files = safeCall(() => ns.ls(server), []);

        for (const file of files) {
            if (!String(file).endsWith(".cct")) continue;

            const contract = inspectContract(ns, server, file);
            rawRows.push(contract);
        }
    }

    const dedupe = dedupeContracts(rawRows);
    const preferred = dedupe.preferred;
    const duplicates = dedupe.duplicates;

    preferred.sort(comparePreferredContracts);

    const valid = preferred.filter(r => r.valid);
    const invalid = preferred.filter(r => !r.valid);
    const homePreferred = preferred.filter(r => r.server === "home");
    const remotePreferred = preferred.filter(r => r.server !== "home");

    const byType = {};
    for (const r of valid) {
        byType[r.type] = (byType[r.type] || 0) + 1;
    }

    const report = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        summary: {
            serversScanned: servers.length,

            rawContractFilesFound: rawRows.length,
            uniqueContracts: preferred.length,
            duplicateFilesSuppressed: rawRows.length - preferred.length,

            validUniqueContracts: valid.length,
            invalidUniqueContractFiles: invalid.length,

            homePreferredContracts: homePreferred.length,
            remotePreferredContracts: remotePreferred.length,

            byType,

            implemented: "read-only inventory",
            solverImplemented: false,
            warning: "No solve attempts are made by this script.",

            dedupeRule: "fileName + contractType + dataSignature",
            preferenceRule: "home first, then valid, then higher tries remaining",
            note: "dataSignature is derived from the coding contract data because file size is not reliable for .cct inventory.",
        },

        contracts: preferred,
        duplicates,
        rawContracts: rawRows,
    };

    ns.write("/data/manager/contracts.json", JSON.stringify(sanitizeForJson(report), null, 2), "w");

    if (!silent) {
        printReport(ns, report, limit);
    }
}

function inspectContract(ns, server, file) {
    const fileName = baseName(file);

    const base = {
        server,
        file,
        fileName,

        dataTextLength: null,
        dataHash: null,
        dataSignature: null,
        dedupeKey: null,

        preferredScore: 0,
        duplicateCount: 0,
        duplicateLocations: [],

        valid: false,
        type: null,
        triesRemaining: null,
        dataPreview: null,
        dataShape: null,
        error: null,
    };

    try {
        const type = ns.codingcontract.getContractType(file, server);
        const triesRemaining = ns.codingcontract.getNumTriesRemaining(file, server);
        const data = ns.codingcontract.getData(file, server);

        const dataText = JSON.stringify(sanitizeForJson(data));
        const dataHash = simpleHash(dataText);
        const dataSignature = `${type}::${dataText.length}::${dataHash}`;

        const row = {
            ...base,
            valid: true,
            type,
            triesRemaining,

            dataTextLength: dataText.length,
            dataHash,
            dataSignature,
            dedupeKey: makeDedupeKey(fileName, type, dataSignature),

            dataPreview: dataText.length > 600 ? dataText.slice(0, 600) + "..." : dataText,
            dataShape: describeShape(data),
            error: null,
        };

        row.preferredScore = scoreContract(row);
        return row;
    } catch (e) {
        const row = {
            ...base,
            valid: false,
            type: null,
            triesRemaining: null,
            dataTextLength: null,
            dataHash: null,
            dataSignature: "invalid-or-unreadable",
            dedupeKey: makeDedupeKey(fileName, "invalid", "invalid-or-unreadable"),
            error: String(e),
        };

        row.preferredScore = scoreContract(row);
        return row;
    }
}

function dedupeContracts(rows) {
    const groups = new Map();

    for (const row of rows) {
        const key = row.dedupeKey || makeDedupeKey(row.fileName, row.type || "unknown", row.dataSignature || "unknown");

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(row);
    }

    const preferred = [];
    const duplicates = [];

    for (const [key, group] of groups.entries()) {
        group.sort(compareCandidateWithinDuplicateGroup);

        const winner = {
            ...group[0],
            duplicateCount: group.length - 1,
            duplicateLocations: group.slice(1).map(r => ({
                server: r.server,
                file: r.file,
                fileName: r.fileName,
                valid: r.valid,
                type: r.type,
                triesRemaining: r.triesRemaining,
                dataTextLength: r.dataTextLength,
                dataHash: r.dataHash,
                error: r.error,
                preferredScore: r.preferredScore,
            })),
        };

        preferred.push(winner);

        if (group.length > 1) {
            duplicates.push({
                dedupeKey: key,
                preferred: {
                    server: winner.server,
                    file: winner.file,
                    fileName: winner.fileName,
                    valid: winner.valid,
                    type: winner.type,
                    triesRemaining: winner.triesRemaining,
                    dataTextLength: winner.dataTextLength,
                    dataHash: winner.dataHash,
                    preferredScore: winner.preferredScore,
                },
                suppressed: group.slice(1).map(r => ({
                    server: r.server,
                    file: r.file,
                    fileName: r.fileName,
                    valid: r.valid,
                    type: r.type,
                    triesRemaining: r.triesRemaining,
                    dataTextLength: r.dataTextLength,
                    dataHash: r.dataHash,
                    error: r.error,
                    preferredScore: r.preferredScore,
                })),
            });
        }
    }

    return { preferred, duplicates };
}

function scoreContract(row) {
    let score = 0;

    if (row.server === "home") score += 1000000;
    if (row.valid) score += 100000;

    if (row.triesRemaining !== null && Number.isFinite(Number(row.triesRemaining))) {
        score += Number(row.triesRemaining) * 100;
    }

    if (row.file && String(row.file).startsWith("/")) {
        score -= 10;
    }

    return score;
}

function compareCandidateWithinDuplicateGroup(a, b) {
    const scoreDiff = Number(b.preferredScore || 0) - Number(a.preferredScore || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const homeDiff = Number(b.server === "home") - Number(a.server === "home");
    if (homeDiff !== 0) return homeDiff;

    const validDiff = Number(b.valid) - Number(a.valid);
    if (validDiff !== 0) return validDiff;

    const triesDiff = Number(b.triesRemaining || 0) - Number(a.triesRemaining || 0);
    if (triesDiff !== 0) return triesDiff;

    const serverDiff = String(a.server).localeCompare(String(b.server));
    if (serverDiff !== 0) return serverDiff;

    return String(a.file).localeCompare(String(b.file));
}

function comparePreferredContracts(a, b) {
    const homeDiff = Number(b.server === "home") - Number(a.server === "home");
    if (homeDiff !== 0) return homeDiff;

    const validDiff = Number(b.valid) - Number(a.valid);
    if (validDiff !== 0) return validDiff;

    const typeDiff = String(a.type || "").localeCompare(String(b.type || ""));
    if (typeDiff !== 0) return typeDiff;

    const duplicateDiff = Number(b.duplicateCount || 0) - Number(a.duplicateCount || 0);
    if (duplicateDiff !== 0) return duplicateDiff;

    const serverDiff = String(a.server).localeCompare(String(b.server));
    if (serverDiff !== 0) return serverDiff;

    return String(a.file).localeCompare(String(b.file));
}

function printReport(ns, report, limit) {
    const s = report.summary;

    ns.print("CONTRACT INVENTORY");
    ns.print("=".repeat(118));
    ns.print(`Servers scanned:          ${s.serversScanned}`);
    ns.print(`Raw .cct files found:     ${s.rawContractFilesFound}`);
    ns.print(`Unique contracts:         ${s.uniqueContracts}`);
    ns.print(`Duplicates suppressed:    ${s.duplicateFilesSuppressed}`);
    ns.print(`Valid unique contracts:   ${s.validUniqueContracts}`);
    ns.print(`Invalid unique files:     ${s.invalidUniqueContractFiles}`);
    ns.print(`Preferred on home:        ${s.homePreferredContracts}`);
    ns.print(`Preferred remote:         ${s.remotePreferredContracts}`);
    ns.print(`Solver implemented:       ${s.solverImplemented ? "yes" : "no"}`);
    ns.print(`Dedupe:                   ${s.dedupeRule}`);
    ns.print("");

    ns.print("TYPE SUMMARY");
    ns.print("-".repeat(118));

    const types = Object.keys(s.byType).sort((a, b) => s.byType[b] - s.byType[a]);

    if (types.length === 0) {
        ns.print("No valid contracts found.");
    } else {
        for (const type of types) {
            ns.print(`${pad(type, 64)} ${s.byType[type]}`);
        }
    }

    ns.print("");
    ns.print(`CONTRACTS — showing first ${limit}`);
    ns.print("-".repeat(118));

    const columns = [
        ["server", "Server", 18],
        ["fileName", "Name", 28],
        ["dataSizeText", "Data size", 10],
        ["type", "Type", 34],
        ["triesRemaining", "Tries", 7],
        ["duplicateCount", "Dupes", 7],
        ["validText", "Valid", 7],
    ];

    printHeader(ns, columns);

    for (const row of report.contracts.slice(0, limit)) {
        const display = {
            ...row,
            validText: row.valid ? "yes" : "no",
            triesRemaining: row.triesRemaining === null ? "" : row.triesRemaining,
            dataSizeText: row.dataTextLength === null ? "?" : `${row.dataTextLength}B`,
        };

        ns.print(columns.map(([key, _label, width]) => pad(String(display[key] ?? ""), width)).join(" | "));
    }

    if (report.contracts.length > limit) {
        ns.print("");
        ns.print(`Hidden unique rows: ${report.contracts.length - limit}`);
        ns.print(`Use: run info-contracts.js ${report.contracts.length}`);
    }

    ns.print("");
    ns.print("JSON output:");
    ns.print("/data/manager/contracts.json");

    if (s.duplicateFilesSuppressed > 0) {
        ns.print("");
        ns.print("Duplicate details are preserved in:");
        ns.print("/data/manager/contracts.json -> duplicates");
    }
}

function scanAll(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    for (let i = 0; i < queue.length; i++) {
        const host = queue[i];

        for (const next of ns.scan(host)) {
            if (!next || next === "." || next === "..") continue;
            if (seen.has(next)) continue;

            seen.add(next);
            queue.push(next);
        }
    }

    return [...seen].sort((a, b) => {
        if (a === "home") return -1;
        if (b === "home") return 1;
        return a.localeCompare(b);
    });
}

function isValidHost(ns, host) {
    if (!host || host === "." || host === "..") return false;

    try {
        if (typeof ns.serverExists === "function") {
            return ns.serverExists(host);
        }
    } catch {
        return false;
    }

    try {
        ns.ls(host);
        return true;
    } catch {
        return false;
    }
}

function baseName(path) {
    path = String(path || "");
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}

function makeDedupeKey(fileName, type, dataSignature) {
    return [
        String(fileName || "").toLowerCase(),
        String(type || "unknown").toLowerCase(),
        String(dataSignature || "unknown").toLowerCase(),
    ].join("::");
}

function describeShape(value) {
    if (Array.isArray(value)) {
        return {
            kind: "array",
            length: value.length,
            first: value.length > 0 ? describeShape(value[0]) : null,
        };
    }

    if (value === null) {
        return { kind: "null" };
    }

    if (typeof value === "object") {
        return {
            kind: "object",
            keys: Object.keys(value),
        };
    }

    return {
        kind: typeof value,
    };
}

function printHeader(ns, columns) {
    ns.print(columns.map(([_key, label, width]) => pad(label, width)).join(" | "));
    ns.print(columns.map(([_key, _label, width]) => "-".repeat(width)).join("-|-"));
}

function openConsole(ns, width = 1180, height = 720) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is useful but not required.
    }
}

function safeCall(fn, fallback = null) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function sanitizeForJson(value) {
    if (typeof value === "bigint") return value.toString();
    if (value === undefined) return null;
    if (value === null) return null;

    if (typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) return null;
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(sanitizeForJson);
    }

    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = sanitizeForJson(value[key]);
    }

    return output;
}

function pad(value, width) {
    value = String(value ?? "");

    if (value.length > width) {
        return value.slice(0, width - 1) + "…";
    }

    return value + " ".repeat(width - value.length);
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function simpleHash(text) {
    text = String(text || "");

    let hash = 5381;

    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash >>> 0;
    }

    return hash.toString(16).padStart(8, "0");
}