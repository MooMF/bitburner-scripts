/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const server = ns.getHostname();

    if (server === "home") return 0;

    const ignoredFiles = new Set([
        "infect.js",
        "infect-root.js",
        "infect-deploy.js",
        "infect-start.js",
        "process.js",
        "process-state.json",
        "iteration.js",
        "weaken.js",
        "grow.js",
        "hack.js",
        "upload.js",
        "assign-targets.js",
        "check-infection.js",
        "logview.js",
        "clean.js",
        "startup.js",
        "buy-servers.js",
        "rent-capacity.js",
        "rent-share.js",
        "faction-control.js"
    ]);

    const catalog = [];

    for (const file of ns.ls(server)) {
        if (shouldIgnore(file, ignoredFiles)) continue;

        const kind = classifyFile(file);
        const safeName = makeSafeHomeFilename(server, file);
        const homeDestination = `${kind.homeFolder}/${safeName}`;

        const entry = {
            server,
            originalPath: file,
            originalFile: file,
            fileType: kind.type,
            extension: kind.extension,
            homeDestination,
            copied: false,
            moved: false,
            reason: "",
            timestamp: Date.now()
        };

        if (kind.type === "contract") {
            addContractMetadata(ns, entry, file, server);
        }

        if (kind.downloadable) {
            const copyResult = await copyToTypedHomeFolder(ns, file, server, homeDestination);

            entry.copied = copyResult.copied;
            entry.moved = copyResult.moved;
            entry.reason = copyResult.reason;
        } else {
            entry.reason = "catalog-only";
        }

        catalog.push(entry);
        await ns.sleep(5);
    }

    const catalogFile = `/found/${server}_files.json`;

    const data = {
        server,
        timestamp: Date.now(),
        filesFound: catalog.length,
        contractsFound: catalog.filter(x => x.fileType === "contract").length,
        files: catalog
    };

    await ns.write(catalogFile, JSON.stringify(data, jsonReplacer, 2), "w");
    await ns.scp(catalogFile, "home", server);

    await updateHomeIndex(ns, data);

    return 1;
}

function shouldIgnore(file, ignoredFiles) {
    if (ignoredFiles.has(file)) return true;
    if (file.includes("infect-version")) return true;
    if (file.startsWith("tmp-")) return true;
    if (file.startsWith("/found/")) return true;
    if (file.startsWith("/telemetry/")) return true;
    if (file.startsWith("/contracts/")) return true;
    if (file.startsWith("/texts/")) return true;
    if (file.startsWith("/lit/")) return true;
    if (file.startsWith("/scripts/")) return true;
    if (file.startsWith("/catalog/")) return true;

    return false;
}

function classifyFile(file) {
    const lower = file.toLowerCase();

    if (lower.endsWith(".cct")) {
        return {
            type: "contract",
            extension: ".cct",
            homeFolder: "/contracts",
            downloadable: true
        };
    }

    if (lower.endsWith(".txt")) {
        return {
            type: "text",
            extension: ".txt",
            homeFolder: "/texts",
            downloadable: true
        };
    }

    if (lower.endsWith(".lit")) {
        return {
            type: "literature",
            extension: ".lit",
            homeFolder: "/lit",
            downloadable: true
        };
    }

    if (lower.endsWith(".script")) {
        return {
            type: "legacy-script",
            extension: ".script",
            homeFolder: "/scripts/legacy",
            downloadable: true
        };
    }

    if (lower.endsWith(".js")) {
        return {
            type: "javascript",
            extension: ".js",
            homeFolder: "/scripts/js",
            downloadable: true
        };
    }

    if (lower.endsWith(".json")) {
        return {
            type: "json",
            extension: ".json",
            homeFolder: "/catalog/json",
            downloadable: true
        };
    }

    return {
        type: "other",
        extension: getExtension(file),
        homeFolder: "/catalog/other",
        downloadable: false
    };
}

async function copyToTypedHomeFolder(ns, file, server, homeDestination) {
    try {
        await ns.scp(file, "home", server);

        if (typeof ns.mv === "function") {
            const moved = ns.mv("home", file, homeDestination);

            if (moved) {
                return {
                    copied: true,
                    moved: true,
                    reason: "copied-to-typed-folder"
                };
            }

            return {
                copied: true,
                moved: false,
                reason: "copied-but-move-failed"
            };
        }

        return {
            copied: true,
            moved: false,
            reason: "copied-to-home-root-ns.mv-unavailable"
        };
    } catch (err) {
        return {
            copied: false,
            moved: false,
            reason: `copy-failed: ${String(err)}`
        };
    }
}

function addContractMetadata(ns, entry, file, server) {
    entry.contract = {
        originServer: server,
        originFile: file,
        solveCommandHint: `ns.codingcontract.attempt(answer, "${file}", "${server}")`,
        type: null,
        data: null,
        triesRemaining: null,
        metadataAvailable: false,
        error: null
    };

    if (!ns.codingcontract) {
        entry.contract.error = "codingcontract API unavailable";
        return;
    }

    try {
        entry.contract.type = ns.codingcontract.getContractType(file, server);
        entry.contract.data = ns.codingcontract.getData(file, server);
        entry.contract.triesRemaining = ns.codingcontract.getNumTriesRemaining(file, server);
        entry.contract.metadataAvailable = true;
    } catch (err) {
        entry.contract.error = String(err);
    }
}

async function updateHomeIndex(ns, serverCatalog) {
    const indexFile = "/catalog/files-index.json";

    let index = {
        updated: 0,
        servers: {},
        allFiles: [],
        contracts: []
    };

    try {
        if (ns.fileExists(indexFile, "home")) {
            const existing = ns.read(indexFile);
            if (existing && existing.trim().length > 0) {
                index = JSON.parse(existing);
            }
        }
    } catch (_) {
        index = {
            updated: 0,
            servers: {},
            allFiles: [],
            contracts: []
        };
    }

    index.updated = Date.now();
    index.servers[serverCatalog.server] = {
        timestamp: serverCatalog.timestamp,
        filesFound: serverCatalog.filesFound,
        contractsFound: serverCatalog.contractsFound,
        catalogFile: `/found/${serverCatalog.server}_files.json`
    };

    index.allFiles = (index.allFiles || []).filter(x => x.server !== serverCatalog.server);
    index.contracts = (index.contracts || []).filter(x => x.server !== serverCatalog.server);

    for (const entry of serverCatalog.files) {
        index.allFiles.push(entry);

        if (entry.fileType === "contract") {
            index.contracts.push(entry);
        }
    }

    index.allFiles.sort((a, b) =>
        String(a.fileType).localeCompare(String(b.fileType)) ||
        String(a.server).localeCompare(String(b.server)) ||
        String(a.originalFile).localeCompare(String(b.originalFile))
    );

    index.contracts.sort((a, b) =>
        String(a.server).localeCompare(String(b.server)) ||
        String(a.originalFile).localeCompare(String(b.originalFile))
    );

    await ns.write(indexFile, JSON.stringify(index, jsonReplacer, 2), "w");
}

function jsonReplacer(_key, value) {
    if (typeof value === "bigint") {
        return value.toString();
    }

    return value;
}

function makeSafeHomeFilename(server, file) {
    const cleanFile = file
        .replace(/^\/+/, "")
        .replaceAll("/", "__")
        .replaceAll("\\", "__")
        .replaceAll(" ", "_");

    return `${server}__${cleanFile}`;
}

function getExtension(file) {
    const idx = file.lastIndexOf(".");
    if (idx < 0) return "";
    return file.slice(idx).toLowerCase();
}