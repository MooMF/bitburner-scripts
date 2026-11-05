import { SOLVERS } from "./contract-solvers.js";
/**
 * info-contract-triage.js
 *
 * Read-only contract triage report.
 *
 * Purpose:
 *   - Read /data/manager/contracts.json from info-contracts.js.
 *   - Rank contract handles by solver availability and apparent complexity.
 *   - Prefer solveQueue from info-contracts.js so duplicate rewards are preserved.
 *   - Do not attempt solves.
 *   - Prepare a safe queue for solve-contracts.js.
 *
 * Usage:
 *   run info-contract-triage.js
 *   run info-contract-triage.js 50
 *   run info-contract-triage.js silent
 *
 * Writes:
 *   /data/manager/contracts-triage.json
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

    const inputFile = "/data/manager/contracts.json";
    const outputFile = "/data/manager/contracts-triage.json";

    const contractReport = readJson(ns, inputFile, null);

    if (!contractReport) {
        ns.print(`ERROR: Missing ${inputFile}.`);
        ns.print("Run: run info-contracts.js");
        return;
    }

    const contracts = getContractRows(contractReport);
    const triaged = contracts.map(triageContract);

    triaged.sort(compareTriageRows);

    const summary = buildSummary(triaged);

    const report = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        sourceFile: inputFile,
        summary,
        triage: triaged,
        byBucket: {
            implementedSolver: triaged.filter(r => r.bucket === "implementedSolver"),
            simpleCandidate: triaged.filter(r => r.bucket === "simpleCandidate"),
            complexCandidate: triaged.filter(r => r.bucket === "complexCandidate"),
            manualReview: triaged.filter(r => r.bucket === "manualReview"),
        },
        solveQueue: triaged.filter(r => r.bucket === "implementedSolver" && r.valid && r.triesRemaining > 0),
        warning: "This is a read-only triage report. It does not attempt to solve contracts.",
        nextStep: "Run solve-contracts.js --dry before allowing attempts.",
    };

    ns.write(outputFile, JSON.stringify(sanitizeForJson(report), null, 2), "w");

    if (!silent) {
        printReport(ns, report, limit, outputFile);
    }
}

function getContractRows(contractReport) {
    if (Array.isArray(contractReport.solveQueue)) {
        return contractReport.solveQueue.filter(r => r && r.valid !== false);
    }

    if (Array.isArray(contractReport.rawContracts)) {
        return contractReport.rawContracts.filter(r => r && r.valid !== false);
    }

    return Array.isArray(contractReport.contracts) ? contractReport.contracts : [];
}

function triageContract(contract) {
    const type = String(contract.type || "");
    const dataShape = contract.dataShape || {};
    const triesRemaining = Number(contract.triesRemaining || 0);

    const solver = classifySolver(type);
    const complexity = estimateComplexity(type, dataShape, contract.dataTextLength);

    let bucket = "manualReview";
    let priority = 50;

    if (solver.status === "implemented") {
        bucket = "implementedSolver";
        priority = 10;
    } else if (solver.status === "straightforward") {
        bucket = "simpleCandidate";
        priority = 30;
    } else if (solver.status === "complex") {
        bucket = "complexCandidate";
        priority = 60;
    }

    if (triesRemaining <= 3) priority += 10;
    if (triesRemaining <= 1) priority += 20;

    const server = contract.server || contract.handle?.server;
    const file = contract.file || contract.handle?.file;

    return {
        kind: "codingContract",
        handle: {
            server,
            file,
        },
        server,
        file,
        fileName: contract.fileName || baseName(file),
        type,
        triesRemaining,
        valid: Boolean(contract.valid),

        bucket,
        priority,
        solverKey: solver.key,
        solverStatus: solver.status,
        solverNote: solver.note,
        estimatedComplexity: complexity.level,
        complexityReason: complexity.reason,

        data: contract.data ?? null,
        dataText: contract.dataText ?? null,
        dataTextLength: contract.dataTextLength ?? null,
        dataHash: contract.dataHash ?? null,
        dataShape,
        question: contract.question ?? buildQuestion(type, contract.data ?? contract.dataPreview ?? null),
        questionText: contract.questionText ?? buildQuestionText(type, contract.data ?? contract.dataPreview ?? null),

        recommendedAction: buildRecommendedAction(bucket, solver, triesRemaining),
    };
}

function classifySolver(type) {
    return Object.hasOwn(SOLVERS,type)
        ? {key:type,status:"implemented",note:"Deterministic solver in contract-solvers.js; validate with dummy contract tests before live submission."}
        : {key:null,status:"unknown",note:"Unsupported by installed solver catalogue."};
}

function buildQuestion(type, data) {
    return {
        type: String(type || ""),
        data: sanitizeForJson(data),
        dataText: JSON.stringify(sanitizeForJson(data)),
        prompt: buildQuestionText(type, data),
    };
}

function buildQuestionText(type, data) {
    const dataText = JSON.stringify(sanitizeForJson(data));
    return `${String(type || "Unknown Contract")}: ${dataText}`;
}

function estimateComplexity(type, dataShape, dataTextLength) {
    const len = Number(dataTextLength || 0);

    if ([
        "Find Largest Prime Factor",
        "Encryption I: Caesar Cipher",
        "Encryption II: Vigenère Cipher",
        "Algorithmic Stock Trader I",
        "Algorithmic Stock Trader II",
        "Algorithmic Stock Trader III",
        "Algorithmic Stock Trader IV",
        "Compression I: RLE Compression",
        "HammingCodes: Integer to Encoded Binary",
        "HammingCodes: Encoded Binary to Integer",
    ].includes(type)) {
        return { level: "low", reason: "Scalar/string transform style contract." };
    }

    if ([
        "Find All Valid Math Expressions",
        "Sanitize Parentheses in Expression",
        "Compression III: LZ Compression",
        "Proper 2-Coloring of a Graph",
        "Shortest Path in a Grid",
        "Algorithmic Stock Trader IV",
    ].includes(type)) {
        return { level: "high", reason: "Search/graph/compression/dynamic-programming heavy contract." };
    }

    if (len > 5000) return { level: "high", reason: "Large data payload." };
    if (len > 1000) return { level: "medium", reason: "Moderate data payload." };

    if (dataShape && dataShape.kind === "array" && Number(dataShape.length || 0) > 100) {
        return { level: "medium", reason: "Large array input." };
    }

    return { level: "medium", reason: "Known but not yet measured." };
}

function buildRecommendedAction(bucket, solver, triesRemaining) {
    if (bucket === "implementedSolver") {
        return "Eligible for future automated solve queue after dry-run verification.";
    }

    if (bucket === "simpleCandidate") {
        return "Good candidate for next solver implementation. Add tests before solve attempts.";
    }

    if (bucket === "complexCandidate") {
        return "Implement later. Requires explicit test harness and confidence checks.";
    }

    if (triesRemaining <= 3) {
        return "Manual review only. Low tries remaining.";
    }

    return "No automated action. Keep in inventory.";
}

function compareTriageRows(a, b) {
    const priorityDiff = Number(a.priority || 0) - Number(b.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    const triesDiff = Number(b.triesRemaining || 0) - Number(a.triesRemaining || 0);
    if (triesDiff !== 0) return triesDiff;

    const typeDiff = String(a.type || "").localeCompare(String(b.type || ""));
    if (typeDiff !== 0) return typeDiff;

    const serverDiff = String(a.server || "").localeCompare(String(b.server || ""));
    if (serverDiff !== 0) return serverDiff;

    return String(a.file || "").localeCompare(String(b.file || ""));
}

function buildSummary(rows) {
    const summary = {
        total: rows.length,
        valid: rows.filter(r => r.valid).length,
        buckets: {},
        byType: {},
        byComplexity: {},
        lowTries: rows.filter(r => Number(r.triesRemaining || 0) <= 3).length,
        implementedSolverContracts: rows.filter(r => r.bucket === "implementedSolver").length,
        solverAutomationSafeNow: rows.some(r => r.bucket === "implementedSolver"),
        recommendation: "Run solve-contracts.js --dry first. Then solve only implementedSolver rows.",
    };

    for (const row of rows) {
        summary.buckets[row.bucket] = (summary.buckets[row.bucket] || 0) + 1;
        summary.byType[row.type] = (summary.byType[row.type] || 0) + 1;
        summary.byComplexity[row.estimatedComplexity] = (summary.byComplexity[row.estimatedComplexity] || 0) + 1;
    }

    return summary;
}

function printReport(ns, report, limit, outputFile) {
    const s = report.summary;

    ns.print("CONTRACT TRIAGE");
    ns.print("=".repeat(118));
    ns.print(`Total contracts:       ${s.total}`);
    ns.print(`Valid:                 ${s.valid}`);
    ns.print(`Low tries <= 3:        ${s.lowTries}`);
    ns.print(`Automation safe now:   ${s.solverAutomationSafeNow ? "yes" : "no"}`);
    ns.print(`Recommendation:        ${s.recommendation}`);
    ns.print("");

    ns.print("BUCKETS");
    ns.print("-".repeat(118));
    for (const key of Object.keys(s.buckets).sort()) {
        ns.print(`${pad(key, 28)} ${s.buckets[key]}`);
    }

    ns.print("");
    ns.print("COMPLEXITY");
    ns.print("-".repeat(118));
    for (const key of Object.keys(s.byComplexity).sort()) {
        ns.print(`${pad(key, 28)} ${s.byComplexity[key]}`);
    }

    ns.print("");
    ns.print(`TRIAGE ROWS — showing first ${limit}`);
    ns.print("-".repeat(118));

    const columns = [
        ["bucket", "Bucket", 20],
        ["estimatedComplexity", "Complexity", 12],
        ["type", "Type", 36],
        ["server", "Server", 18],
        ["triesRemaining", "Tries", 7],
        ["questionPreview", "Question", 36],
        ["fileName", "File", 20],
    ];

    printHeader(ns, columns);

    const rows = report.triage || [];

    for (let i = 0; i < rows.slice(0, limit).length; i++) {
        if (i > 0 && i % 20 === 0) {
            ns.print("");
            printHeader(ns, columns);
        }

        const row = rows[i];
        ns.print(columns.map(([key, _label, width]) => pad(String(row[key] ?? ""), width)).join(" | "));
    }

    if (rows.length > limit) {
        ns.print("");
        ns.print(`Hidden rows: ${rows.length - limit}`);
        ns.print(`Use: run info-contract-triage.js ${rows.length}`);
    }

    ns.print("");
    ns.print("JSON output:");
    ns.print(outputFile);
}

function baseName(path) {
    path = String(path || "");
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}

function readJson(ns, file, fallback) {
    try {
        if (!ns.fileExists(file, "home")) return fallback;

        const text = ns.read(file);
        if (!text || !text.trim()) return fallback;

        return JSON.parse(text);
    } catch {
        return fallback;
    }
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
    }
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

function sanitizeForJson(value) {
    if (typeof value === "bigint") return value.toString();
    if (value === undefined) return null;
    if (value === null) return null;

    if (typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) return null;
        return value;
    }

    if (Array.isArray(value)) return value.map(sanitizeForJson);

    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = sanitizeForJson(value[key]);
    }

    return output;
}
