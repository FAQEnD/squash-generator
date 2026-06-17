(function (root, factory) {
    const config =
        typeof module !== "undefined" && module.exports
            ? require("./config.js")
            : root.SquashConfig;
    const time =
        typeof module !== "undefined" && module.exports ? require("./time.js") : root.SquashTime;
    const api = factory(config, time);

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    root.SquashUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (config, time) {
    let highlighterTimer = null;

    function initPlayers() {
        const box = document.getElementById("players");

        config.PLAYER_LIST.forEach(player => {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            const name = document.createElement("span");

            checkbox.type = "checkbox";
            checkbox.id = "p_" + player;
            checkbox.checked = config.DEFAULT_SELECTED.has(player);
            name.textContent = player;

            label.append(checkbox, name);
            box.append(label);
        });
    }

    function autoSeed() {
        document.getElementById("seed").value = Math.floor(Math.random() * 1e9).toString();
    }

    function getSelectedPlayers() {
        return config.PLAYER_LIST.filter(player => document.getElementById("p_" + player).checked);
    }

    function readScheduleOptions() {
        return {
            seed: document.getElementById("seed").value,
            games: +document.getElementById("games").value,
            courts: +document.getElementById("courts").value,
            players: getSelectedPlayers()
        };
    }

    function readShareState() {
        const options = readScheduleOptions();

        return {
            s: options.seed,
            g: String(options.games),
            c: String(options.courts),
            t: document.getElementById("startTime").value,
            p: options.players
        };
    }

    function applyShareState(state) {
        if (state.s) document.getElementById("seed").value = state.s;
        if (state.g) document.getElementById("games").value = state.g;
        if (state.c) document.getElementById("courts").value = state.c;
        if (state.t) document.getElementById("startTime").value = state.t;

        if (state.p) {
            config.PLAYER_LIST.forEach(player => {
                document.getElementById("p_" + player).checked = false;
            });
            state.p.forEach(player => {
                const el = document.getElementById("p_" + player);
                if (el) el.checked = true;
            });
        }
    }

    function appendCell(row, tagName, text) {
        const cell = document.createElement(tagName);
        cell.textContent = text;
        row.append(cell);
    }

    function renderTable(results, courts) {
        const table = document.createElement("table");
        const header = document.createElement("tr");
        let currentMinutes = time.parseTimeToMinutes(document.getElementById("startTime").value);

        appendCell(header, "th", "Час");
        for (let court = 1; court <= courts; court++) {
            appendCell(header, "th", "Корт " + court);
        }
        appendCell(header, "th", "Відпочивають");
        table.append(header);

        results.forEach(result => {
            const row = document.createElement("tr");
            const timeLabel = time.formatTimeRange(currentMinutes, config.GAME_DURATION_MINUTES);

            currentMinutes += config.GAME_DURATION_MINUTES;

            appendCell(row, "td", timeLabel);
            result.pairs.forEach(pair => {
                appendCell(row, "td", `${pair[0]} ${config.TIME_RANGE_SEPARATOR} ${pair[1]}`);
            });
            appendCell(row, "td", result.rest.join(", "));
            table.append(row);
        });

        document.getElementById("tableBox").replaceChildren(table);
    }

    function appendListItem(list, label, value) {
        const item = document.createElement("li");
        item.textContent = `${label}: ${value}`;
        list.append(item);
    }

    function createSection(titleText) {
        const fragment = document.createDocumentFragment();
        const title = document.createElement("h3");
        const list = document.createElement("ul");

        title.textContent = titleText;
        fragment.append(title, list);

        return { fragment, list };
    }

    function renderStats(playerCount, pairCount, courtPins, courtPinOrder) {
        const playersSection = createSection("Ігри гравців");
        const pinsSection = createSection("Прив'язка до кортів");
        const pairsSection = createSection("Статистика пар");

        Object.keys(playerCount).forEach(player => {
            appendListItem(playersSection.list, player, playerCount[player]);

            const court = courtPins[player]
                ? `Корт ${courtPins[player]} (#${courtPinOrder[player]})`
                : "не призначено";
            appendListItem(pinsSection.list, player, court);
        });

        Object.keys(pairCount).forEach(pair => {
            appendListItem(pairsSection.list, pair, pairCount[pair] + "×");
        });

        document.getElementById("statsPlayers").replaceChildren(playersSection.fragment);
        document
            .getElementById("statsPairs")
            .replaceChildren(pinsSection.fragment, pairsSection.fragment);
    }

    function quoteCsvValue(value) {
        return `"${value.replace(/"/g, '""')}"`;
    }

    function exportCSV() {
        const table = document.querySelector("#tableBox table");
        if (!table) return;

        let csv = "";
        table.querySelectorAll("tr").forEach(row => {
            csv += [...row.children].map(cell => quoteCsvValue(cell.innerText)).join(",") + "\n";
        });

        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "matches.csv";
        a.click();
    }

    function applyReadonlyMode(isShared) {
        if (!isShared) return;

        ["playersTitle", "players", "settingsTitle", "statsTitle", "statsBox"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add("readonly-hidden");
        });

        document
            .querySelectorAll(".controls, .row")
            .forEach(el => el.classList.add("readonly-hidden"));

        document.querySelector("header").classList.remove("readonly-hidden");
        document.getElementById("tableBox").classList.add("readonly-table-box");
    }

    function highlightCurrentGameRow() {
        const table = document.querySelector("#tableBox table");
        if (!table) return;

        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const rows = table.querySelectorAll("tr");

        rows.forEach((row, index) => {
            if (index === 0) return;

            const timeCell = row.children[0];
            if (!timeCell) return;

            const range = time.parseTimeRange(timeCell.innerText);
            if (!range) return;

            row.classList.toggle("current-game", time.isMinuteInRange(nowMinutes, range));
        });
    }

    function startGameTimeHighlighter() {
        highlightCurrentGameRow();

        if (highlighterTimer) {
            clearInterval(highlighterTimer);
        }

        highlighterTimer = setInterval(highlightCurrentGameRow, 30_000);
    }

    return {
        initPlayers,
        autoSeed,
        readScheduleOptions,
        readShareState,
        applyShareState,
        renderTable,
        renderStats,
        exportCSV,
        applyReadonlyMode,
        startGameTimeHighlighter
    };
});
