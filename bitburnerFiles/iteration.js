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
        "buy-servers.js",
        "startup.js",
        "check-infection.js",
        "logview.js",
        "clean.js",
        "start-processes.js",
        "rent-capacity.js",
        "rent-share.js"
    ]);

    const ignoredPrefixes = [
        "/found/",
        "/telemetry/",
        "/data/manager/",
        "/data/"
    ];

    const catalog = [];

    for (const file of ns.ls(server)) {
        if (ignoredFiles.has(file)) continue;
        if (file.includes("infect-version")) continue;
        if (file.startsWith("tmp-")) continue;
        if (ignoredPrefixes.some(prefix => file.startsWith(prefix))) continue;

        const downloadable =
            file.endsWith(".txt") ||
            file.endsWith(".lit") ||
            file.endsWith(".script") ||
            file.endsWith(".cct");

        if (downloadable) {
            try {
                await ns.scp(file, "home", server);

                catalog.push({
                    file,
                    copied: true,
                    reason: "downloadable"
                });
            } catch {
                catalog.push({
                    file,
                    copied: false,
                    reason: "copy-failed"
                });
            }
        } else {
            catalog.push({
                file,
                copied: false,
                reason: "catalog-only"
            });
        }

        await ns.sleep(5);
    }

    const catalogFile = `/found/${server}_files.json`;

    const data = {
        server,
        timestamp: Date.now(),
        files: catalog
    };

    await ns.write(catalogFile, JSON.stringify(data, null, 2), "w");
    await ns.scp(catalogFile, "home", server);

    return 1;
}