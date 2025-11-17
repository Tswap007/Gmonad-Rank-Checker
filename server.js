const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// Enable CORS for frontend access
app.use(cors());
app.use(express.static('public')); // Serve static files

let holdersData = [];
let lastUpdate = null;

// Fetch all token holders
async function fetchAllHolders() {
    console.log("Starting to fetch token holders...");
    const url = "https://api.socialscan.io/monad-testnet/v1/developer/api";

    let page = 1;
    const offset = 100;
    let all = [];

    try {
        while (true) {
            console.log("Fetching page:", page);

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
            page++;
        }

        // Sort by balance (descending)
        all.sort((a, b) => {
            const balanceA = parseFloat(a.TokenHolderQuantity || 0);
            const balanceB = parseFloat(b.TokenHolderQuantity || 0);
            return balanceB - balanceA;
        });

        holdersData = all;
        lastUpdate = new Date();

        // Save to file as backup
        fs.writeFileSync(
            "all_tokenholders.json",
            JSON.stringify(all, null, 2)
        );

        console.log(`Successfully fetched ${all.length} holders at ${lastUpdate}`);
        return all;
    } catch (error) {
        console.error("Error fetching holders:", error.message);

        // Try to load from backup file if fetch fails
        if (fs.existsSync("all_tokenholders.json")) {
            console.log("Loading from backup file...");
            const backup = JSON.parse(fs.readFileSync("all_tokenholders.json", "utf8"));
            holdersData = backup;
            return backup;
        }

        throw error;
    }
}

// Schedule updates every 6 hours
function scheduleUpdates() {
    const SIX_HOURS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    setInterval(async () => {
        console.log("Running scheduled update...");
        await fetchAllHolders();
    }, SIX_HOURS);
}

// API endpoint to get all holders data
app.get("/api/holders", (req, res) => {
    res.json({
        success: true,
        data: holdersData,
        lastUpdate: lastUpdate,
        totalHolders: holdersData.length
    });
});

// API endpoint to search for a specific address
app.get("/api/rank/:address", (req, res) => {
    const address = req.params.address.toLowerCase();

    const index = holdersData.findIndex(
        holder => holder.TokenHolderAddress.toLowerCase() === address
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
        nextUpdate: lastUpdate ? new Date(lastUpdate.getTime() + 6 * 60 * 60 * 1000) : null
    });
});

// Initialize and start server
async function startServer() {
    // Try to load existing data first
    if (fs.existsSync("all_tokenholders.json")) {
        console.log("Loading existing data...");
        holdersData = JSON.parse(fs.readFileSync("all_tokenholders.json", "utf8"));
        lastUpdate = new Date(fs.statSync("all_tokenholders.json").mtime);
        console.log(`Loaded ${holdersData.length} holders from file`);
    }

    // Fetch fresh data
    await fetchAllHolders();

    // Schedule future updates
    scheduleUpdates();

    // Start the server
    app.listen(PORT, () => {
        console.log(`Server running on http://gmonad-rank-checker-production.up.railway.app:${PORT}`);
        console.log(`API available at http://gmonad-rank-checker-production.up.railway.app:${PORT}/api/holders`);
        console.log(`Data will update every 6 hours`);
        console.log(`Next update at: ${new Date(Date.now() + 6 * 60 * 60 * 1000)}`);
    });
}

startServer();