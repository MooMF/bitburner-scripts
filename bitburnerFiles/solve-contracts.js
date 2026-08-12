/**
 * solve-contracts.js
 *
 * Home-only coding contract solver.
 *
 * Purpose:
 *   - Read contract handles produced by info-contracts.js / info-contract-triage.js.
 *   - Re-read live contract data from the original host before solving.
 *   - Attempt only implemented solver types unless --type/--file filters narrow the run.
 *   - Write a solve result report.
 *
 * Current implemented solvers:
 *   - Find Largest Prime Factor
 *   - Encryption I: Caesar Cipher
 *   - Encryption II: Vigenère Cipher
 *   - Algorithmic Stock Trader I
 *   - Algorithmic Stock Trader II
 *   - Algorithmic Stock Trader III
 *   - Algorithmic Stock Trader IV
 *
 * Important model:
 *   Coding contracts are remote handles: { server, file }.
 *   Do not copy .cct files to home. Use ns.codingcontract APIs with server + file.
 *
 * Usage:
 *   run solve-contracts.js --dry
 *   run solve-contracts.js
 *   run solve-contracts.js --type prime --dry
 *   run solve-contracts.js --type encryption --dry
 *   run solve-contracts.js --type stock --dry
 *   run solve-contracts.js --server n00dles --file contract-123.cct --dry
 *
 * Files:
 *   Reads:  /data/manager/contracts-triage.json, or /data/manager/contracts.json
 *   Reads:  /data/primes.json
 *   Writes: /data/manager/contracts-solve-results.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const opts = parseArgs(ns.args);

    if (!opts.silent) {
        ns.clearLog();
        openConsole(ns, 1180, 720);
    }

    const report = loadContractReport(ns);
    if (!report) {
        ns.tprint("Missing contract report. Run: run info-contracts.js");
        return;
    }

    const primes = loadPrimeTable(ns, opts.primeFile);
    const rows = getCandidateRows(report)
        .filter(r => filterRow(r, opts))
        .sort(compareRows);

    const results = [];

    for (const row of rows) {
        const server = row.server || row.handle?.server;
        const file = row.file || row.handle?.file;

        if (!server || !file) continue;

        const result = solveOne(ns, server, file, row, primes, opts);
        results.push(result);

        if (!opts.silent) printResult(ns, result);
    }

    const output = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        dryRun: opts.dryRun,
        source: report.sourcePath || report.sourceFile || "unknown",
        summary: summarizeResults(results),
        results,
    };

    ns.write("/data/manager/contracts-solve-results.json", JSON.stringify(sanitizeForJson(output), null, 2), "w");

    ns.tprint(`Contract solver complete. seen=${results.length}, solved=${output.summary.solved}, failed=${output.summary.failed}, dryRun=${opts.dryRun}`);
}

function solveOne(ns, server, file, row, primes, opts) {
    const base = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        server,
        file,
        fileName: baseName(file),
        catalogType: row.type || null,
        liveType: null,
        triesRemaining: null,
        solverKey: null,
        catalogQuestion: row.question || null,
        catalogQuestionText: row.questionText || null,
        liveData: null,
        liveDataText: null,
        liveQuestion: null,
        liveQuestionText: null,
        dataHash: null,
        answer: null,
        dryRun: opts.dryRun,
        solved: false,
        failed: false,
        skipped: false,
        reward: "",
        error: null,
        note: null,
    };

    try {
        if (!ns.serverExists(server)) {
            return { ...base, skipped: true, error: "Server no longer exists or is not reachable." };
        }

        if (!ns.fileExists(file, server)) {
            return { ...base, skipped: true, error: "Contract file no longer exists on source server." };
        }

        const liveType = ns.codingcontract.getContractType(file, server);
        const triesRemaining = ns.codingcontract.getNumTriesRemaining(file, server);
        const data = ns.codingcontract.getData(file, server);
        const dataText = JSON.stringify(sanitizeForJson(data));
        const dataHash = simpleHash(dataText);
        const solverKey = solverKeyForType(liveType);

        base.liveType = liveType;
        base.triesRemaining = triesRemaining;
        base.solverKey = solverKey;
        base.liveData = sanitizeForJson(data);
        base.liveDataText = dataText;
        base.liveQuestion = buildQuestion(liveType, data);
        base.liveQuestionText = buildQuestionText(liveType, data);
        base.dataHash = dataHash;

        if (!solverKey) {
            return { ...base, skipped: true, note: "No implemented solver for live contract type." };
        }

        if (triesRemaining <= 0) {
            return { ...base, skipped: true, note: "No tries remaining." };
        }

        const answer = solveByKey(solverKey, data, primes);
        base.answer = answer;

        if (opts.dryRun) {
            return { ...base, solved: true, note: "Dry-run only. Answer not submitted." };
        }

        const reward = ns.codingcontract.attempt(answer, file, server, { returnReward: true });

        if (reward) {
            return { ...base, solved: true, reward };
        }

        return { ...base, failed: true, error: "Answer rejected." };
    } catch (e) {
        return { ...base, failed: true, error: String(e) };
    }
}

function solveByKey(key, data, primes) {
    switch (key) {
        case "largestPrimeFactor":
            return solveLargestPrimeFactor(Number(data), primes);
        case "caesarCipher":
            return solveCaesarCipher(data);
        case "vigenereCipher":
            return solveVigenereCipher(data);
        case "stockTrader1":
            return solveStockTrader1(data);
        case "stockTrader2":
            return solveStockTrader2(data);
        case "stockTrader3":
            return solveStockTraderK(data, 2);
        case "stockTrader4":
            return solveStockTrader4(data);
        default:
            throw new Error(`No solver function for ${key}`);
    }
}

function solverKeyForType(type) {
    switch (String(type || "")) {
        case "Find Largest Prime Factor":
            return "largestPrimeFactor";
        case "Encryption I: Caesar Cipher":
            return "caesarCipher";
        case "Encryption II: Vigenère Cipher":
            return "vigenereCipher";
        case "Algorithmic Stock Trader I":
            return "stockTrader1";
        case "Algorithmic Stock Trader II":
            return "stockTrader2";
        case "Algorithmic Stock Trader III":
            return "stockTrader3";
        case "Algorithmic Stock Trader IV":
            return "stockTrader4";
        default:
            return null;
    }
}

function solveCaesarCipher(data) {
    const { text, shift } = parseCipherTuple(data, "Caesar");
    const n = normalizeShift(Number(shift));

    return String(text)
        .split("")
        .map(ch => shiftUppercaseLetter(ch, -n))
        .join("");
}

function solveVigenereCipher(data) {
    const { text, key } = parseCipherTuple(data, "Vigenere");
    const cleanKey = String(key || "").toUpperCase().replace(/[^A-Z]/g, "");

    if (!cleanKey) {
        throw new Error("Invalid Vigenere key.");
    }

    let out = "";
    let keyIndex = 0;

    for (const ch of String(text)) {
        if (!isUppercaseAsciiLetter(ch)) {
            out += ch;
            continue;
        }

        const keyChar = cleanKey[keyIndex % cleanKey.length];
        const keyShift = keyChar.charCodeAt(0) - 65;
        out += shiftUppercaseLetter(ch, keyShift);
        keyIndex++;
    }

    return out;
}

function parseCipherTuple(data, label) {
    if (!Array.isArray(data) || data.length < 2) {
        throw new Error(`${label} contract expected [text, keyOrShift], got ${JSON.stringify(data)}`);
    }

    return {
        text: String(data[0]),
        shift: data[1],
        key: data[1],
    };
}

function shiftUppercaseLetter(ch, shift) {
    if (!isUppercaseAsciiLetter(ch)) return ch;

    const base = 65;
    const ord = ch.charCodeAt(0) - base;
    const shifted = normalizeShift(ord + shift);
    return String.fromCharCode(base + shifted);
}

function isUppercaseAsciiLetter(ch) {
    if (!ch || ch.length !== 1) return false;
    const code = ch.charCodeAt(0);
    return code >= 65 && code <= 90;
}

function normalizeShift(n) {
    return ((Number(n) % 26) + 26) % 26;
}

function solveStockTrader1(data) {
    const prices = parsePriceArray(data, "Algorithmic Stock Trader I");
    let minPrice = Infinity;
    let best = 0;

    for (const price of prices) {
        if (price < minPrice) minPrice = price;
        const profit = price - minPrice;
        if (profit > best) best = profit;
    }

    return best;
}

function solveStockTrader2(data) {
    const prices = parsePriceArray(data, "Algorithmic Stock Trader II");
    let profit = 0;

    for (let i = 1; i < prices.length; i++) {
        const delta = prices[i] - prices[i - 1];
        if (delta > 0) profit += delta;
    }

    return profit;
}

function solveStockTrader4(data) {
    if (!Array.isArray(data) || data.length < 2) {
        throw new Error(`Algorithmic Stock Trader IV expected [k, prices], got ${JSON.stringify(data)}`);
    }

    const k = Math.floor(Number(data[0]));
    const prices = parsePriceArray(data[1], "Algorithmic Stock Trader IV");
    return solveStockTraderK(prices, k);
}

function solveStockTraderK(data, maxTransactions) {
    const prices = parsePriceArray(data, `Algorithmic Stock Trader K=${maxTransactions}`);
    const n = prices.length;
    const k = Math.floor(Number(maxTransactions));

    if (n < 2 || k <= 0) return 0;

    if (k >= Math.floor(n / 2)) {
        return solveStockTrader2(prices);
    }

    const hold = Array(k + 1).fill(-Infinity);
    const cash = Array(k + 1).fill(0);

    for (const price of prices) {
        for (let t = 1; t <= k; t++) {
            hold[t] = Math.max(hold[t], cash[t - 1] - price);
            cash[t] = Math.max(cash[t], hold[t] + price);
        }
    }

    return Math.max(0, cash[k]);
}

function parsePriceArray(data, label) {
    if (!Array.isArray(data)) {
        throw new Error(`${label} expected an array of prices, got ${JSON.stringify(data)}`);
    }

    return data.map(Number).filter(n => Number.isFinite(n));
}

function solveLargestPrimeFactor(input, primes) {
    let n = Number(input);

    if (!Number.isFinite(n)) {
        throw new Error(`Invalid numeric input: ${input}`);
    }

    n = Math.floor(Math.abs(n));
    if (n < 2) return n;

    let largest = 1;

    for (const p of primes) {
        if (p * p > n) break;

        while (n % p === 0) {
            largest = p;
            n = Math.floor(n / p);
        }
    }

    let start = primes.length > 0 ? Number(primes[primes.length - 1]) + 2 : 3;
    if (start < 3) start = 3;
    if (start % 2 === 0) start++;

    for (let d = start; d * d <= n; d += 2) {
        while (n % d === 0) {
            largest = d;
            n = Math.floor(n / d);
        }
    }

    if (n > 1) largest = n;
    return largest;
}

function getCandidateRows(report) {
    if (Array.isArray(report.solveQueue)) {
        return report.solveQueue;
    }

    if (report.byBucket && Array.isArray(report.byBucket.implementedSolver)) {
        return report.byBucket.implementedSolver;
    }

    if (Array.isArray(report.triage)) {
        return report.triage.filter(r => r.bucket === "implementedSolver");
    }

    if (Array.isArray(report.rawContracts)) {
        return report.rawContracts.filter(r => r.valid !== false);
    }

    if (Array.isArray(report.contracts)) {
        return report.contracts.filter(r => r.valid !== false);
    }

    return [];
}

function filterRow(row, opts) {
    if (!row || row.valid === false) return false;

    const server = row.server || row.handle?.server;
    const file = row.file || row.handle?.file;
    const type = String(row.type || "");
    const key = row.solverKey || solverKeyForType(type);

    if (!server || !file) return false;
    if (!key) return false;

    if (opts.server && server !== opts.server) return false;
    if (opts.file && file !== opts.file && baseName(file) !== opts.file) return false;

    if (opts.type) {
        const requested = opts.type.toLowerCase();
        if (requested === "prime" || requested === "largestprimefactor" || requested === "largest-prime-factor") {
            return key === "largestPrimeFactor";
        }

        if (requested === "encryption" || requested === "cipher" || requested === "crypto") {
            return key === "caesarCipher" || key === "vigenereCipher";
        }

        if (requested === "caesar" || requested === "caesar-cipher") {
            return key === "caesarCipher";
        }

        if (requested === "vigenere" || requested === "vigenère" || requested === "vigenere-cipher" || requested === "vigenère-cipher") {
            return key === "vigenereCipher";
        }

        if (requested === "stock" || requested === "trader" || requested === "stock-trader") {
            return key === "stockTrader1" || key === "stockTrader2" || key === "stockTrader3" || key === "stockTrader4";
        }

        if (requested === "stock1" || requested === "trader1" || requested === "stock-trader-i") {
            return key === "stockTrader1";
        }

        if (requested === "stock2" || requested === "trader2" || requested === "stock-trader-ii") {
            return key === "stockTrader2";
        }

        if (requested === "stock3" || requested === "trader3" || requested === "stock-trader-iii") {
            return key === "stockTrader3";
        }

        if (requested === "stock4" || requested === "trader4" || requested === "stock-trader-iv") {
            return key === "stockTrader4";
        }

        return type.toLowerCase().includes(requested) || String(key).toLowerCase().includes(requested);
    }

    return true;
}

function loadContractReport(ns) {
    const preferred = [
        "/data/manager/contracts-triage.json",
        "/data/manager/contracts.json",
    ];

    for (const path of preferred) {
        const report = readJson(ns, path, null);
        if (report) return { ...report, sourcePath: path };
    }

    return null;
}

function loadPrimeTable(ns, path) {
    const fallback = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];

    if (!ns.fileExists(path, "home")) {
        ns.print(`[warn] ${path} not found. Using small fallback prime table.`);
        return fallback;
    }

    try {
        const raw = ns.read(path);
        const parsed = JSON.parse(raw);

        const primes = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.primes)
                ? parsed.primes
                : [];

        const clean = [...new Set(primes
            .map(Number)
            .filter(n => Number.isInteger(n) && n >= 2))]
            .sort((a, b) => a - b);

        return clean.length > 0 ? clean : fallback;
    } catch (e) {
        ns.print(`[warn] Could not parse ${path}: ${e}`);
        return fallback;
    }
}

function parseArgs(args) {
    const opts = {
        dryRun: false,
        silent: false,
        type: null,
        server: null,
        file: null,
        primeFile: "/data/primes.json",
    };

    for (let i = 0; i < args.length; i++) {
        const arg = String(args[i]);
        const lower = arg.toLowerCase();

        if (lower === "--dry" || lower === "dry" || lower === "--dry-run") {
            opts.dryRun = true;
            continue;
        }

        if (lower === "--silent" || lower === "silent") {
            opts.silent = true;
            continue;
        }

        if (lower === "--type") {
            opts.type = String(args[++i] || "");
            continue;
        }

        if (lower === "--server" || lower === "--host") {
            opts.server = String(args[++i] || "");
            continue;
        }

        if (lower === "--file") {
            opts.file = String(args[++i] || "");
            continue;
        }

        if (lower === "--prime-file") {
            opts.primeFile = String(args[++i] || opts.primeFile);
            continue;
        }
    }

    return opts;
}

function compareRows(a, b) {
    const typeDiff = String(a.type || "").localeCompare(String(b.type || ""));
    if (typeDiff !== 0) return typeDiff;

    const triesDiff = Number(b.triesRemaining || 0) - Number(a.triesRemaining || 0);
    if (triesDiff !== 0) return triesDiff;

    const serverDiff = String(a.server || a.handle?.server || "").localeCompare(String(b.server || b.handle?.server || ""));
    if (serverDiff !== 0) return serverDiff;

    return String(a.file || a.handle?.file || "").localeCompare(String(b.file || b.handle?.file || ""));
}

function summarizeResults(results) {
    const summary = {
        total: results.length,
        solved: results.filter(r => r.solved).length,
        failed: results.filter(r => r.failed).length,
        skipped: results.filter(r => r.skipped).length,
        rewards: results.filter(r => r.reward).map(r => r.reward),
        byType: {},
        bySolverKey: {},
    };

    for (const r of results) {
        const type = r.liveType || r.catalogType || "unknown";
        const key = r.solverKey || "unsupported";
        summary.byType[type] = (summary.byType[type] || 0) + 1;
        summary.bySolverKey[key] = (summary.bySolverKey[key] || 0) + 1;
    }

    return summary;
}

function printResult(ns, r) {
    const state = r.skipped ? "skip" : r.failed ? "FAIL" : r.solved ? "OK" : "?";
    ns.print(`[${state}] ${r.liveType || r.catalogType || "unknown"} @ ${r.server}/${r.fileName}`);

    if (r.liveQuestionText) {
        ns.print(`     question=${truncate(r.liveQuestionText, 150)}`);
    }

    if (r.answer !== null && r.answer !== undefined) {
        ns.print(`     answer=${JSON.stringify(r.answer)}`);
    }

    if (r.reward) ns.print(`     reward=${r.reward}`);
    if (r.note) ns.print(`     note=${r.note}`);
    if (r.error) ns.print(`     error=${r.error}`);
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

function truncate(value, maxLength) {
    value = String(value ?? "");
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 1)) + "…";
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

function baseName(path) {
    path = String(path || "");
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}

function openConsole(ns, width = 1180, height = 720) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
    }
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
