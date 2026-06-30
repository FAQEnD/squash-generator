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
    let lastGamesValue = null;
    let latestScheduleSlots = [];
    let activePaymentPlayer = null;

    function initPlayers() {
        const box = document.getElementById("players");
        const gamesValue = document.getElementById("games").value;

        lastGamesValue = gamesValue;

        config.PLAYER_LIST.forEach(player => {
            const card = document.createElement("div");
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            const name = document.createElement("span");
            const availability = document.createElement("span");
            const fromText = document.createElement("span");
            const fromInput = document.createElement("input");
            const toText = document.createElement("span");
            const toInput = document.createElement("input");

            card.className = "player-card";
            label.className = "player-select";
            checkbox.type = "checkbox";
            checkbox.id = "p_" + player;
            checkbox.checked = config.DEFAULT_SELECTED.has(player);
            name.textContent = player;
            name.className = "player-name";
            availability.className = "availability-range";
            fromText.textContent = "Грає з";
            fromInput.type = "number";
            fromInput.min = "1";
            fromInput.value = "1";
            fromInput.id = "from_" + player;
            fromInput.title = "З гри";
            fromInput.setAttribute("aria-label", player + ": грає з гри");
            toText.textContent = "по";
            toInput.type = "number";
            toInput.min = "1";
            toInput.value = gamesValue;
            toInput.id = "to_" + player;
            toInput.title = "По гру";
            toInput.setAttribute("aria-label", player + ": грає по гру");

            availability.append(fromText, fromInput, toText, toInput);
            label.append(checkbox, name);
            card.append(label, availability);
            box.append(card);
        });
    }

    function autoSeed() {
        document.getElementById("seed").value = Math.floor(Math.random() * 1e9).toString();
    }

    function syncAvailabilityPlaceholders() {
        const games = document.getElementById("games").value;

        config.PLAYER_LIST.forEach(player => {
            const toInput = document.getElementById("to_" + player);
            if (toInput.value === "" || toInput.value === lastGamesValue) {
                toInput.value = games;
            }
        });

        lastGamesValue = games;
    }

    function getSelectedPlayers() {
        return config.PLAYER_LIST.filter(player => document.getElementById("p_" + player).checked);
    }

    function readPlayerAvailability(players, games) {
        const playerAvailability = {};

        players.forEach(player => {
            playerAvailability[player] = {
                from: document.getElementById("from_" + player).value || "1",
                to: document.getElementById("to_" + player).value || String(games)
            };
        });

        return playerAvailability;
    }

    function normalizePaymentTarget(value) {
        const rawValue = String(value || "").trim();
        const cardDigits = rawValue.replace(/[\s-]/g, "");

        if (/^[\d\s-]+$/.test(rawValue) && /^\d{16,19}$/.test(cardDigits)) {
            return {
                type: "card",
                value: cardDigits,
                label: cardDigits.replace(/(\d{4})(?=\d)/g, "$1 ").trim()
            };
        }

        try {
            const url = new URL(rawValue);
            const host = url.hostname.toLowerCase();

            if (
                url.protocol === "https:" &&
                (host === "send.monobank.ua" || host === "monobank.ua")
            ) {
                return {
                    type: "mono",
                    value: url.href,
                    label: "Monobank"
                };
            }
        } catch {
            return null;
        }

        return null;
    }

    function readBoundedPaymentGameNumber(value, fallback, games) {
        const number = parseInt(value, 10);
        if (!Number.isFinite(number)) return fallback;

        return Math.min(Math.max(number, 1), games);
    }

    function countAvailableGames(range, games) {
        const from = readBoundedPaymentGameNumber(range && range.from, 1, games);
        const to = readBoundedPaymentGameNumber(range && range.to, games, games);

        return Math.max(0, to - from + 1);
    }

    function parseRentalCost(value) {
        const cost = Number.parseFloat(String(value || "").replace(",", "."));

        return Number.isFinite(cost) && cost > 0 ? cost : 0;
    }

    function calculatePaymentShares(players, playerAvailability, games, rentalCost) {
        const cost = parseRentalCost(rentalCost);
        const entries = players.map(player => ({
            player,
            games: countAvailableGames(playerAvailability && playerAvailability[player], games)
        }));
        const totalGames = entries.reduce((sum, entry) => sum + entry.games, 0);

        if (cost <= 0 || totalGames <= 0) {
            return [];
        }

        return entries
            .filter(entry => entry.games > 0)
            .map(entry => ({
                player: entry.player,
                games: entry.games,
                amount: Math.ceil((cost * entry.games) / totalGames)
            }));
    }

    function readScheduleOptions() {
        const games = +document.getElementById("games").value;
        const players = getSelectedPlayers();

        return {
            seed: document.getElementById("seed").value,
            games,
            courts: +document.getElementById("courts").value,
            players,
            playerAvailability: readPlayerAvailability(players, games),
            paymentTarget: document.getElementById("paymentTarget").value,
            rentalCost: document.getElementById("rentalCost").value
        };
    }

    function readShareState() {
        const options = readScheduleOptions();

        return {
            s: options.seed,
            g: String(options.games),
            c: String(options.courts),
            t: document.getElementById("startTime").value,
            p: options.players,
            a: options.playerAvailability,
            pay: options.paymentTarget,
            cost: options.rentalCost
        };
    }

    function applyShareState(state) {
        if (state.s) document.getElementById("seed").value = state.s;
        if (state.g) document.getElementById("games").value = state.g;
        if (state.c) document.getElementById("courts").value = state.c;
        if (state.t) document.getElementById("startTime").value = state.t;
        if (state.pay) document.getElementById("paymentTarget").value = state.pay;
        if (state.cost) document.getElementById("rentalCost").value = state.cost;
        if (state.g) syncAvailabilityPlaceholders();

        if (state.p) {
            config.PLAYER_LIST.forEach(player => {
                document.getElementById("p_" + player).checked = false;
            });
            state.p.forEach(player => {
                const el = document.getElementById("p_" + player);
                if (el) el.checked = true;
            });
        }

        if (state.a) {
            Object.keys(state.a).forEach(player => {
                const fromInput = document.getElementById("from_" + player);
                const toInput = document.getElementById("to_" + player);
                if (fromInput && state.a[player].from) fromInput.value = state.a[player].from;
                if (toInput && state.a[player].to) toInput.value = state.a[player].to;
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
        latestScheduleSlots = [];

        appendCell(header, "th", "Час");
        for (let court = 1; court <= courts; court++) {
            appendCell(header, "th", "Корт " + court);
        }
        appendCell(header, "th", "Відпочивають");
        table.append(header);

        results.forEach(result => {
            const row = document.createElement("tr");
            const timeLabel = time.formatTimeRange(currentMinutes, config.GAME_DURATION_MINUTES);
            const slot = { time: timeLabel, courts: [], rest: result.rest };

            currentMinutes += config.GAME_DURATION_MINUTES;

            appendCell(row, "td", timeLabel);
            result.pairs.forEach((pair, index) => {
                slot.courts.push({
                    court: index + 1,
                    players: pair
                });
                appendCell(row, "td", formatCourtSlot(pair));
            });
            appendCell(row, "td", result.rest.join(", "));
            table.append(row);
            latestScheduleSlots.push(slot);
        });

        document.getElementById("tableBox").replaceChildren(table);
    }

    function formatCourtSlot(pair) {
        if (pair.length === 0) return "—";
        if (pair.length === 1) return pair[0];

        return `${pair[0]} ${config.TIME_RANGE_SEPARATOR} ${pair[1]}`;
    }

    function populatePlayerScheduleSelect() {
        const select = document.getElementById("playerScheduleSelect");
        if (!select) return;

        select.replaceChildren(
            ...getSelectedPlayers().map(player => {
                const option = document.createElement("option");
                option.value = player;
                option.textContent = player;
                return option;
            })
        );
    }

    function appendScheduleText(parent, className, text) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        parent.append(span);
    }

    function findPlayerSchedule(player) {
        const matches = [];

        latestScheduleSlots.forEach(slot => {
            let playerMatch = null;

            slot.courts.forEach(courtInfo => {
                if (courtInfo.players.includes(player)) {
                    playerMatch = {
                        time: slot.time,
                        court: courtInfo.court,
                        opponent: courtInfo.players.find(p => p !== player),
                        isRest: false
                    };
                }
            });

            if (playerMatch) {
                matches.push(playerMatch);
                return;
            }

            if (slot.rest.includes(player)) {
                matches.push({
                    time: slot.time,
                    isRest: true
                });
            }
        });

        return matches;
    }

    function renderPlayerSchedule(player) {
        const result = document.getElementById("playerScheduleResult");
        if (!result || !player) return;

        activePaymentPlayer = player;
        highlightPaymentPlayer();

        const matches = findPlayerSchedule(player);

        if (matches.length === 0) {
            const message = document.createElement("p");
            message.className = "empty-schedule";
            message.textContent = `${player} не має ігор у цьому розкладі.`;
            result.replaceChildren(message);
            return;
        }

        const title = document.createElement("h3");
        const list = document.createElement("ul");
        title.textContent = player;
        list.className = "player-schedule-list";

        matches.forEach(match => {
            const item = document.createElement("li");
            appendScheduleText(item, "schedule-time", match.time);

            if (match.isRest) {
                item.className = "schedule-rest-row";
                appendScheduleText(item, "schedule-rest", "Відпочинок");
                appendScheduleText(item, "schedule-opponent", "");
            } else {
                appendScheduleText(item, "schedule-court", `Корт ${match.court}`);
                appendScheduleText(item, "schedule-opponent", `з ${match.opponent}`);
            }

            list.append(item);
        });

        result.replaceChildren(title, list);
        highlightCurrentGameRow();
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

    function createPaymentTargetElement(paymentTarget) {
        if (paymentTarget.type === "mono") {
            const link = document.createElement("a");
            link.className = "payment-target payment-link";
            link.href = paymentTarget.value;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = paymentTarget.label;
            return link;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "payment-target payment-copy";
        button.textContent = paymentTarget.label;
        button.title = "Скопіювати номер картки";
        button.addEventListener("click", () => {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(paymentTarget.value);
            }
        });

        return button;
    }

    function renderPaymentSummary(options) {
        const main = document.querySelector("main");
        const section = document.getElementById("paymentSection");
        const content = document.getElementById("paymentContent");
        const box = document.getElementById("paymentBox");
        if (!box) return;

        const paymentTarget = normalizePaymentTarget(options.paymentTarget);
        const shares = calculatePaymentShares(
            options.players,
            options.playerAvailability,
            options.games,
            options.rentalCost
        );

        if (!paymentTarget || shares.length === 0) {
            box.replaceChildren();
            box.classList.add("readonly-hidden");
            if (section) section.classList.add("readonly-hidden");
            if (content) content.hidden = true;
            return;
        }

        const title = document.createElement("h3");
        const targetRow = document.createElement("div");
        const targetLabel = document.createElement("span");
        const list = document.createElement("ul");

        title.textContent = "Оплата";
        targetRow.className = "payment-target-row";
        targetLabel.className = "payment-target-label";
        targetLabel.textContent = "Реквізити";
        list.className = "payment-list";

        targetRow.append(targetLabel, createPaymentTargetElement(paymentTarget));

        shares.forEach(share => {
            const item = document.createElement("li");
            const name = document.createElement("span");
            const amount = document.createElement("strong");

            item.dataset.player = share.player;
            name.textContent = `${share.player} (${share.games})`;
            amount.textContent = `${share.amount} грн`;
            item.append(name, amount);
            list.append(item);
        });

        box.replaceChildren(title, targetRow, list);
        box.classList.remove("readonly-hidden");
        if (section) section.classList.remove("readonly-hidden");
        if (content) {
            content.hidden = Boolean(main && main.classList.contains("readonly-main"));
        }
        highlightPaymentPlayer();
    }

    function highlightPaymentPlayer() {
        document.querySelectorAll(".payment-list li").forEach(row => {
            row.classList.toggle(
                "payment-player-active",
                activePaymentPlayer !== null && row.dataset.player === activePaymentPlayer
            );
        });
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

        document.querySelector("main").classList.add("readonly-main");
        document.querySelector("header").classList.remove("readonly-hidden");
        document.getElementById("tableBox").classList.add("readonly-table-box");

        populatePlayerScheduleSelect();

        const scheduleBox = document.getElementById("playerScheduleBox");
        if (scheduleBox) {
            scheduleBox.classList.remove("readonly-hidden");
        }

        setupSharedAccordions();
        setSharedSectionExpanded("playerSchedule", true);
        setSharedSectionExpanded("results", false);

        const paymentSection = document.getElementById("paymentSection");
        if (paymentSection && !paymentSection.classList.contains("readonly-hidden")) {
            setSharedSectionExpanded("payment", false);
        }
    }

    function getSharedSectionElements(name) {
        return {
            section: document.getElementById(name + "Section"),
            toggle: document.getElementById(name + "Toggle"),
            content: document.getElementById(name + "Content")
        };
    }

    function setSharedSectionExpanded(name, isExpanded) {
        const { toggle, content } = getSharedSectionElements(name);
        if (!toggle || !content) return;

        toggle.setAttribute("aria-expanded", String(isExpanded));
        content.hidden = !isExpanded;
    }

    function toggleSharedSection(name) {
        const { toggle } = getSharedSectionElements(name);
        if (!toggle) return;

        setSharedSectionExpanded(name, toggle.getAttribute("aria-expanded") !== "true");
    }

    function revealPaymentSection() {
        const { section } = getSharedSectionElements("payment");
        if (!section || section.classList.contains("readonly-hidden")) return;

        setSharedSectionExpanded("payment", true);
        if (section.scrollIntoView) {
            section.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    }

    function setupSharedAccordions() {
        ["playerSchedule", "results", "payment"].forEach(name => {
            const { toggle } = getSharedSectionElements(name);
            if (!toggle || toggle.dataset.boundAccordion === "true") return;

            toggle.addEventListener("click", () => toggleSharedSection(name));
            toggle.dataset.boundAccordion = "true";
        });

        const paymentButton = document.getElementById("showPaymentBtn");
        if (paymentButton && paymentButton.dataset.boundPaymentJump !== "true") {
            paymentButton.addEventListener("click", revealPaymentSection);
            paymentButton.dataset.boundPaymentJump = "true";
        }
    }

    function highlightCurrentPlayerScheduleRows(nowMinutes) {
        document.querySelectorAll(".player-schedule-list li").forEach(row => {
            const timeCell = row.querySelector(".schedule-time");
            if (!timeCell) return;

            const range = time.parseTimeRange(timeCell.innerText);
            if (!range) return;

            row.classList.toggle("current-game", time.isMinuteInRange(nowMinutes, range));
        });
    }

    function highlightCurrentGameRow() {
        const table = document.querySelector("#tableBox table");
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        if (table) {
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

        highlightCurrentPlayerScheduleRows(nowMinutes);
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
        syncAvailabilityPlaceholders,
        readScheduleOptions,
        readShareState,
        applyShareState,
        renderTable,
        renderPlayerSchedule,
        renderStats,
        renderPaymentSummary,
        exportCSV,
        applyReadonlyMode,
        startGameTimeHighlighter,
        setSharedSectionExpanded,
        toggleSharedSection,
        revealPaymentSection,
        normalizePaymentTarget,
        countAvailableGames,
        calculatePaymentShares
    };
});
