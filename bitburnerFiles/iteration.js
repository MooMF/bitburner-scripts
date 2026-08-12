/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const server = ns.getHostname();

    if (server === "home") return 0;

    const ignoredPrefixes = [
        "/found/",
        "/telemetry/",
        "/data/manager/",
        "/data/"
    ];

    const catalog = [];

    for (const file of ns.ls(server)) {
        if (file.includes("infect-version")) continue;
        if (file.startsWith("tmp-")) continue;
        if (ignoredPrefixes.some(prefix => file.startsWith(prefix))) continue;

        const downloadable =
            file.endsWith(".txt") ||
            file.endsWith(".lit") ||
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
