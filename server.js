const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend access
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

let holdersData = [];
let lastUpdate = null;
let isFetching = false;
let fetchProgress = 0;

// Fetch all token holders
async function fetchAllHolders() {
    if (isFetching) {
        console.log("Already fetching, skipping...");
        return holdersData;
    }

    isFetching = true;
    fetchProgress = 0;
    console.log("Starting to fetch token holders...");
    const url = "https://api.socialscan.io/monad-testnet/v1/developer/api";

    let page = 1;
    const offset = 100;
    let all = [];

    try {
        // First, try to estimate total pages
        let estimatedPages = 100; // Default estimate

        while (true) {
            console.log(`Fetching page: ${page}`);

            const params = {
                module: "token",
                action: "tokenholderlist",
                contractaddress: "0x93C33B999230eE117863a82889Fdb342cd6D5C64",
                page,
                offset,
                apikey: "8f9d3e27-a516-4c08-b235-7d94f02ca91b"
            };

            const res = await axios.get(url, { params });
            const result = res.data.result;

            if (!result || result.length === 0) {
                console.log("No more results. Stopping.");
                break;
            }

            all = all.concat(result);

            // Update progress
            fetchProgress = Math.min(95, (page / estimatedPages) * 100);

            // Sort and update cache incrementally every 10 pages
            if (page % 10 === 0) {
                const sorted = [...all].sort((a, b) => {
                    const balanceA = parseFloat(a.TokenHolderQuantity || 0);
                    const balanceB = parseFloat(b.TokenHolderQuantity || 0);
                    return balanceB - balanceA;
                });
                holdersData = sorted;
                lastUpdate = new Date();
            }

            page++;

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Final sort
        all.sort((a, b) => {
            const balanceA = parseFloat(a.TokenHolderQuantity || 0);
            const balanceB = parseFloat(b.TokenHolderQuantity || 0);
            return balanceB - balanceA;
        });

        holdersData = all;
        lastUpdate = new Date();
        fetchProgress = 100;

        // Save to file as backup
        fs.writeFileSync(
            "all_tokenholders.json",
            JSON.stringify(all, null, 2)
        );

        console.log(`Successfully fetched ${all.length} holders at ${lastUpdate}`);
        isFetching = false;
        return all;
    } catch (error) {
        console.error("Error fetching holders:", error.message);
        isFetching = false;
        fetchProgress = 0;

        // Try to load from backup file if fetch fails
        if (fs.existsSync("all_tokenholders.json")) {
            console.log("Loading from backup file...");
            const backup = JSON.parse(fs.readFileSync("all_tokenholders.json", "utf8"));
            holdersData = backup;
            lastUpdate = new Date(fs.statSync("all_tokenholders.json").mtime);
            return backup;
        }

        throw error;
    }
}

// Schedule updates every 6 hours
function scheduleUpdates() {
    const SIX_HOURS = 6 * 60 * 60 * 1000;

    setInterval(async () => {
        console.log("Running scheduled update...");
        await fetchAllHolders();
    }, SIX_HOURS);
}

// API endpoint to get holders data (returns cached data instantly)
app.get("/api/holders", (req, res) => {
    res.json({
        success: true,
        data: holdersData,
        lastUpdate: lastUpdate,
        totalHolders: holdersData.length,
        isFetching: isFetching,
        fetchProgress: fetchProgress
    });
});

// API endpoint to search for a specific address (fast lookup)
app.post("/api/search", (req, res) => {
    const { address } = req.body;

    if (!address) {
        return res.status(400).json({
            success: false,
            message: "Address is required"
        });
    }

    const normalizedAddress = address.toLowerCase();
    const index = holdersData.findIndex(
        holder => holder.TokenHolderAddress.toLowerCase() === normalizedAddress
    );

    if (index === -1) {
        return res.json({
            success: false,
            message: "Address not found"
        });
    }

    const holder = holdersData[index];

    res.json({
        success: true,
        data: {
            rank: index + 1,
            address: holder.TokenHolderAddress,
            balance: holder.TokenHolderQuantity,
            totalHolders: holdersData.length
        },
        lastUpdate: lastUpdate
    });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        lastUpdate: lastUpdate,
        totalHolders: holdersData.length,
        isFetching: isFetching,
        fetchProgress: fetchProgress,
        dataReady: holdersData.length > 0
    });
});

// Force refresh endpoint (triggers background update)
app.post("/api/refresh", async (req, res) => {
    if (isFetching) {
        return res.json({
            success: false,
            message: "Already fetching data",
            progress: fetchProgress
        });
    }

    // Start fetching in background
    fetchAllHolders().catch(err => console.error("Refresh error:", err));

    res.json({
        success: true,
        message: "Data refresh started"
    });
});

// Initialize and start server
async function startServer() {
    // Load existing data first for instant startup
    if (fs.existsSync("all_tokenholders.json")) {
        console.log("Loading existing data from file...");
        try {
            const fileData = fs.readFileSync("all_tokenholders.json", "utf8");
            holdersData = JSON.parse(fileData);
            lastUpdate = new Date(fs.statSync("all_tokenholders.json").mtime);
            console.log(`✓ Loaded ${holdersData.length} holders from cache (${lastUpdate.toLocaleString()})`);
        } catch (err) {
            console.error("Error loading backup file:", err);
        }
    }

    // Start server immediately with cached data
    app.listen(PORT, () => {
        console.log(`✓ Server running on http://localhost:${PORT}`);
        console.log(`✓ API available at http://localhost:${PORT}/api/holders`);

        if (holdersData.length > 0) {
            console.log(`✓ Serving ${holdersData.length} holders from cache`);
        }
    });

    // Determine if we need to fetch fresh data
    const sixHours = 6 * 60 * 60 * 1000;
    const dataAge = lastUpdate ? Date.now() - lastUpdate.getTime() : Infinity;

    if (dataAge > sixHours || holdersData.length === 0) {
        console.log("Fetching fresh data in background...");
        fetchAllHolders().then(() => {
            console.log(`✓ Data updated! Next update at: ${new Date(Date.now() + sixHours).toLocaleString()}`);
            scheduleUpdates();
        }).catch(err => {
            console.error("Initial fetch error:", err);
            scheduleUpdates();
        });
    } else {
        console.log(`✓ Cache is fresh (${Math.round(dataAge / 60000)} minutes old)`);
        console.log(`✓ Next update at: ${new Date(lastUpdate.getTime() + sixHours).toLocaleString()}`);
        scheduleUpdates();
    }
}

startServer();